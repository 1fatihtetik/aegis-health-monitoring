"""AEGIS backend. One process holds the onboard store and the ground store (PRD section 11 note)."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config import Config
from app.runtime import Runtime

DISCLAIMER = "Decision support only, not a medical diagnosis. The source of each value is shown with it."


def create_app(run_loop: bool = True) -> FastAPI:
    rt = Runtime(Config())

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        if run_loop:
            rt.start()
        yield
        await rt.stop()

    app = FastAPI(title="AEGIS", version="0.1.0", lifespan=lifespan)
    app.state.rt = rt
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.include_router(router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "disclaimer": DISCLAIMER}

    @app.websocket("/ws/live")
    async def live(ws: WebSocket, node: str = "onboard") -> None:
        node = "ground" if node == "ground" else "onboard"
        await ws.accept()
        rt.clients[ws] = node
        try:
            await ws.send_json(rt.snapshot_message(node))
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            rt.clients.pop(ws, None)

    return app


app = create_app()
