from collections.abc import Callable
from typing import Any

from fastmcp import FastMCP


RETAINED_TOOL_NAMES = {
    "export_google_workspace_file",
    # Docs
    "get_doc_content",
    "modify_doc_text",
    "find_and_replace_doc",
    "insert_doc_elements",
    "insert_doc_image",
    "update_doc_headers_footers",
    "batch_update_doc",
    "inspect_doc_structure",
    "create_table_with_data",
    "update_paragraph_style",
    "get_doc_as_markdown",
    "manage_doc_tab",
    "list_document_comments",
    "manage_document_comment",
    # Sheets
    "get_spreadsheet_info",
    "read_sheet_values",
    "modify_sheet_values",
    "format_sheet_range",
    "manage_conditional_formatting",
    "create_sheet",
    "list_sheet_tables",
    "append_table_rows",
    "resize_sheet_dimensions",
    "move_sheet_rows",
    "list_spreadsheet_comments",
    "manage_spreadsheet_comment",
    # Slides
    "get_presentation",
    "batch_update_presentation",
    "get_page",
    "get_page_thumbnail",
    "list_presentation_comments",
    "manage_presentation_comment",
}


mcp = FastMCP(name="google-workspace")


class FilteredToolServer:
    def tool(self, *args: Any, **kwargs: Any) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        register = mcp.tool(*args, **kwargs)

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            if func.__name__ not in RETAINED_TOOL_NAMES:
                return func
            return register(func)

        return decorator


server = FilteredToolServer()
