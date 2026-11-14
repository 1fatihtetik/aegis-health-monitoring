# On Windows without make, run the commands by hand (see README.md).
.PHONY: dev backend frontend test lint demo

backend:
	cd backend && python -m uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	$(MAKE) -j2 backend frontend

test:
	cd backend && python -m pytest -q
	@if [ -f frontend/package.json ]; then cd frontend && npx vitest run; fi

lint:
	cd backend && python -m ruff check .
	@if [ -f frontend/package.json ]; then cd frontend && npx tsc --noEmit; fi

demo:
	curl -s -X POST http://localhost:8000/api/v1/sim/scenario -H "Content-Type: application/json" -d '{"name":"demo_5min","seed":42}'
