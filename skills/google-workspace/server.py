import logging

from core.server import mcp

# Import retained modules to register their tools.
import gdocs.docs_tools  # noqa: F401,E402
import gsheets.sheets_tools  # noqa: F401,E402
import gslides.slides_tools  # noqa: F401,E402
import core.office_export  # noqa: F401,E402


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    mcp.run(show_banner=False)


if __name__ == "__main__":
    main()
