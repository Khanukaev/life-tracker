"""Run the MCP server: `python -m lifetracker_mcp` (port 8001)."""

import uvicorn

from lifetracker_mcp.app import create_app

if __name__ == "__main__":
    uvicorn.run(
        create_app(),
        host="0.0.0.0",  # noqa: S104  (inside the container, behind Caddy)
        port=8001,
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_level="warning",
    )
