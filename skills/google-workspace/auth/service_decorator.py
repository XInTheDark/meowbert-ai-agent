import functools
import inspect
from collections.abc import Callable
from typing import Any

from googleapiclient.discovery import build

from core.proxy_http import MeowbertProxyHttp
from core.reference_context import resolve_reference


SERVICE_VERSIONS = {
    "drive": "v3",
    "docs": "v1",
    "sheets": "v4",
    "slides": "v1",
}

TARGET_PARAMETERS = ("document_id", "spreadsheet_id", "presentation_id", "file_id")


def _remove_injected_parameters(
    signature: inspect.Signature, service_parameter_names: set[str]
) -> inspect.Signature:
    parameters = [
        parameter
        for parameter in signature.parameters.values()
        if parameter.name not in service_parameter_names
        and parameter.name != "user_google_email"
    ]
    return signature.replace(parameters=parameters)


def _resolve_call_reference(
    arguments: dict[str, Any], service_type: str
) -> tuple[dict[str, Any], Any]:
    target_name = next((name for name in TARGET_PARAMETERS if name in arguments), None)
    if target_name is None or not isinstance(arguments[target_name], str):
        raise ValueError("This Google Workspace tool does not expose a supported file target.")
    reference = resolve_reference(arguments[target_name], service_type)
    normalized = dict(arguments)
    normalized[target_name] = reference.item_id
    return normalized, reference


def _build_service(service_type: str, version: str | None, reference_token: str):
    service_version = version or SERVICE_VERSIONS[service_type]
    return build(
        service_type,
        service_version,
        http=MeowbertProxyHttp(reference_token),
        cache_discovery=False,
        static_discovery=True,
    )


def require_google_service(service_type: str, _scopes: Any, version: str | None = None):
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        original_signature = inspect.signature(func)
        wrapper_signature = _remove_injected_parameters(original_signature, {"service"})

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            bound = wrapper_signature.bind(*args, **kwargs)
            bound.apply_defaults()
            arguments, reference = _resolve_call_reference(dict(bound.arguments), service_type)
            service = _build_service(service_type, version, reference.reference_token)
            arguments["service"] = service
            arguments["user_google_email"] = "workspace-source"
            try:
                return await func(**arguments)
            finally:
                close = getattr(service, "close", None)
                if callable(close):
                    close()

        wrapper.__signature__ = wrapper_signature
        return wrapper

    return decorator


def require_multiple_services(service_configs: list[dict[str, Any]]):
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        service_parameter_names = {config["param_name"] for config in service_configs}
        original_signature = inspect.signature(func)
        wrapper_signature = _remove_injected_parameters(
            original_signature, service_parameter_names
        )

        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            bound = wrapper_signature.bind(*args, **kwargs)
            bound.apply_defaults()
            reference_service = next(
                (
                    config["service_type"]
                    for config in service_configs
                    if config["service_type"] in {"docs", "sheets", "slides"}
                ),
                service_configs[0]["service_type"],
            )
            arguments, reference = _resolve_call_reference(
                dict(bound.arguments), reference_service
            )
            services = []
            for config in service_configs:
                service = _build_service(
                    config["service_type"],
                    config.get("version"),
                    reference.reference_token,
                )
                services.append(service)
                arguments[config["param_name"]] = service
            arguments["user_google_email"] = "workspace-source"
            try:
                return await func(**arguments)
            finally:
                for service in services:
                    close = getattr(service, "close", None)
                    if callable(close):
                        close()

        wrapper.__signature__ = wrapper_signature
        return wrapper

    return decorator
