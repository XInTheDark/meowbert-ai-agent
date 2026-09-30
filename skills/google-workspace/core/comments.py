import asyncio
import json
from typing import Optional

from mcp.types import ToolAnnotations

from auth.service_decorator import require_google_service
from core.server import server
from core.utils import handle_http_errors


READ_ANNOTATIONS = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)
MANAGE_ANNOTATIONS = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=False,
    openWorldHint=True,
)


async def _list_comments(service, file_id: str, max_comments: int | None) -> str:
    limit = 100 if max_comments is None else max(0, min(max_comments, 1000))
    comments = []
    page_token = None
    while len(comments) < limit:
        response = await asyncio.to_thread(
            service.comments()
            .list(
                fileId=file_id,
                fields="nextPageToken,comments(id,content,author,createdTime,modifiedTime,resolved,quotedFileContent,replies(content,author,id,createdTime,modifiedTime))",
                pageSize=min(100, limit - len(comments)),
                pageToken=page_token,
            )
            .execute
        )
        comments.extend(response.get("comments", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return json.dumps({"comments": comments[:limit]}, ensure_ascii=False)


async def _manage_comment(
    service,
    file_id: str,
    action: str,
    comment_content: Optional[str],
    comment_id: Optional[str],
) -> str:
    normalized = action.strip().lower()
    if normalized == "create":
        if not comment_content:
            raise ValueError("comment_content is required for create action")
        result = await asyncio.to_thread(
            service.comments()
            .create(fileId=file_id, body={"content": comment_content}, fields="*")
            .execute
        )
    elif normalized == "reply":
        if not comment_id or not comment_content:
            raise ValueError("comment_id and comment_content are required for reply action")
        result = await asyncio.to_thread(
            service.replies()
            .create(
                fileId=file_id,
                commentId=comment_id,
                body={"content": comment_content},
                fields="*",
            )
            .execute
        )
    elif normalized == "resolve":
        if not comment_id:
            raise ValueError("comment_id is required for resolve action")
        result = await asyncio.to_thread(
            service.comments()
            .update(
                fileId=file_id,
                commentId=comment_id,
                body={"resolved": True},
                fields="*",
            )
            .execute
        )
    else:
        raise ValueError("action must be create, reply, or resolve")
    return json.dumps(result, ensure_ascii=False)


def create_comment_tools(app_name: str, file_id_param: str):
    del file_id_param
    list_name = f"list_{app_name}_comments"
    manage_name = f"manage_{app_name}_comment"
    app_title = app_name.replace("_", " ").title()

    async def list_comments_impl(
        service,
        user_google_email: str,
        file_id: str,
        max_comments: int | None = None,
    ) -> str:
        del user_google_email
        return await _list_comments(service, file_id, max_comments)

    async def manage_comment_impl(
        service,
        user_google_email: str,
        file_id: str,
        action: str,
        comment_content: Optional[str] = None,
        comment_id: Optional[str] = None,
    ) -> str:
        """Create, reply to, or resolve a comment on an authorized Google file.

        Supported actions are `create`, `reply`, and `resolve`. Updating the
        content of an existing comment is not supported. `create` requires
        `comment_content`; `reply` requires `comment_id` and `comment_content`;
        `resolve` requires `comment_id`.
        """
        del user_google_email
        return await _manage_comment(
            service, file_id, action, comment_content, comment_id
        )

    list_comments_impl.__name__ = list_name
    manage_comment_impl.__name__ = manage_name

    list_comments = require_google_service("drive", "drive_read")(
        handle_http_errors(list_name, is_read_only=True)(list_comments_impl)
    )
    manage_comment = require_google_service("drive", "drive")(
        handle_http_errors(manage_name)(manage_comment_impl)
    )
    server.tool(title=f"List {app_title} Comments", annotations=READ_ANNOTATIONS)(
        list_comments
    )
    server.tool(title=f"Manage {app_title} Comment", annotations=MANAGE_ANNOTATIONS)(
        manage_comment
    )
    return {"list_comments": list_comments, "manage_comment": manage_comment}
