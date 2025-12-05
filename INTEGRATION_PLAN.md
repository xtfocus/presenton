# Presenton API Integration Plan

> **👋 New to this project?** Read [`HANDOFF.md`](HANDOFF.md) first for a quick start guide!

## Current Status ✅

### Completed
- ✅ Service added to `docker-compose.yml`
- ✅ Configured with OpenAI (text) and Google Gemini (images)
- ✅ Shared PostgreSQL database setup
- ✅ Shared SECRET_KEY for authentication ready
- ✅ API-only Dockerfile created (`Dockerfile.api-only`)
- ✅ Volume configuration complete

### Service Configuration

**Service Name**: `presenton-api`  
**Port**: 8001 (configurable via `PRESENTON_API_PORT`)

**LLM Providers**:
- **Text Generation**: OpenAI (`LLM=openai`)
- **Image Generation**: Google Gemini Flash (`IMAGE_PROVIDER=gemini_flash`)

**Database**: Shared PostgreSQL (same as backend)  
**Authentication**: Shared JWT via `SECRET_KEY`

## Next Steps

### 1. Start the Service

```bash
# Build and start
docker compose up -d presenton-api

# Check logs
docker compose logs -f presenton-api

# Verify health
curl http://localhost:8001/api/v1/ppt/presentation/all
```

### 2. Test API Directly

```bash
# Get JWT token from backend
TOKEN=$(curl -X POST http://localhost:8000/api/v1/login/access-token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=your@email.com&password=yourpassword" \
  | jq -r '.access_token')

# Generate test presentation
curl -X POST http://localhost:8001/api/v1/ppt/presentation/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "content": "Introduction to Machine Learning",
    "n_slides": 5,
    "language": "English",
    "template": "general",
    "export_as": "pptx"
  }'
```

## Future Plans (POC)

### Phase 1: Backend Integration (Recommended)

**Goal**: Create backend endpoints that proxy to Presenton API using SSE streaming

**Why**: 
- Centralized authentication
- User context and association
- Basic error handling
- Minimal logging for debugging

**Implementation**:

1. **Create Presentation data model** (`fastapi_backend/app/models.py`):

```python
class Presentation(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="user.id")  # Only user association
    presenton_presentation_id: UUID  # Presenton's ID
    presenton_path: str  # Path in Presenton storage
    minio_object_key: Optional[str]  # MinIO object key if copied
    title: Optional[str]
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
```

2. **Create backend routes** (`fastapi_backend/app/api/routes/presentations.py`):

```python
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.api.deps import CurrentUser, AsyncSessionDep
import httpx

router = APIRouter(prefix="/presentations", tags=["presentations"])
PRESENTON_API_URL = "http://presenton-api:8000"

@router.post("/create")
async def create_presentation(
    request: dict,
    current_user: CurrentUser,
):
    """Create presentation (quick - generates outlines)"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{PRESENTON_API_URL}/api/v1/ppt/presentation/create",
            json=request,
        )
        response.raise_for_status()
        data = response.json()
        # Store in backend Presentation model
        # Return presentation_id
        return data

@router.post("/prepare")
async def prepare_presentation(
    presentation_id: str,
    request: dict,
    current_user: CurrentUser,
):
    """Prepare presentation with layout"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{PRESENTON_API_URL}/api/v1/ppt/presentation/prepare",
            json={"presentation_id": presentation_id, **request},
        )
        response.raise_for_status()
        return response.json()

@router.get("/stream/{presentation_id}")
async def stream_presentation(
    presentation_id: str,
    current_user: CurrentUser,
):
    """Stream presentation generation via SSE"""
    async with httpx.AsyncClient(timeout=600.0) as client:
        async with client.stream(
            "GET",
            f"{PRESENTON_API_URL}/api/v1/ppt/presentation/stream/{presentation_id}",
        ) as response:
            response.raise_for_status()
            
            async def generate():
                async for chunk in response.aiter_bytes():
                    yield chunk
            
            return StreamingResponse(
                generate(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                }
            )
```

3. **Frontend calls backend** (SSE streaming):

```typescript
// Step 1: Create presentation
const { id } = await createPresentation({
  content: "Topic here",
  n_slides: 8,
  language: "English",
});

// Step 2: Prepare presentation
await preparePresentation(id, {
  outlines: [...],
  layout: {...}
});

// Step 3: Stream generation
const eventSource = new EventSource(
  buildBackendUrl(`presentations/stream/${id}`)
);

eventSource.addEventListener("response", (event) => {
  const data = JSON.parse(event.data);
  // Update UI with progress
});
```

**Benefits**:
- User association (store which user generated what)
- SSE streaming for real-time updates
- Basic error handling
- Minimal logging for debugging

See `PRESENTON_ASYNC_FLOW.md` for detailed SSE implementation guide.


### Phase 2: Notebook Agent Integration (Future)

**Goal**: Add presentation generation tool to notebook agent

**Use Case**:
- Agent tool synthesizes conversation → generates slides outlines with text content
- User gets quick action button in message to jump to slide maker
- Presentations are user-scoped only (no workspace/notebook association)

**Implementation**:

```python
# fastapi_agent/app/agents/notebook_agent.py

@tool
async def generate_presentation(
    content: str,
    n_slides: int = 8,
    language: str = "English",
    template: str = "general"
) -> dict:
    """
    Generate a presentation from content using Presenton.
    Synthesizes conversation content into slide outlines.
    
    Args:
        content: The synthesized content/topic for the presentation
        n_slides: Number of slides to generate (default: 8)
        language: Language for the presentation (default: "English")
        template: Template to use (default: "general")
    
    Returns:
        dict with presentation_id and quick action link
    """
    # Call backend presentation creation endpoint
    # Returns presentation_id for user to view/edit
    ...
```

## Architecture

```
┌─────────────┐
│   Frontend  │
└──────┬──────┘
       │
       │ 1. Create/Prepare (HTTP)
       │ 2. Stream generation (SSE)
       ▼
┌─────────────┐
│   Backend   │  (Validates user, stores metadata)
└──────┬──────┘
       │
       │ 3. Proxies SSE stream
       ▼
┌─────────────┐
│ Presenton   │  (Generates presentation)
│    API      │  (Streams slides as generated)
└─────────────┘
       │
       │ 4. Copy to MinIO
       ▼
┌─────────────┐
│    MinIO    │  (File storage for serving)
└─────────────┘
```

**Flow:**
1. Frontend calls backend to create/prepare presentation
2. Frontend opens SSE stream for real-time updates
3. Backend proxies SSE stream from Presenton
4. On completion, backend copies file to MinIO
5. Frontend gets presigned URL for download

See `PRESENTON_ASYNC_FLOW.md` for detailed SSE implementation.

## Key API Endpoints

### Create Presentation (Quick)
```
POST /api/v1/ppt/presentation/create

Request:
{
  "content": "Topic",
  "n_slides": 8,
  "language": "English",
  "template": "general"
}

Response:
{
  "id": "presentation-uuid"
}
```

### Prepare Presentation (Quick)
```
POST /api/v1/ppt/presentation/prepare

Request:
{
  "presentation_id": "uuid",
  "outlines": [...],
  "layout": {...}
}

Response:
{
  "id": "uuid",
  "outlines": [...],
  ...
}
```

### Stream Presentation (SSE - Long Running)
```
GET /api/v1/ppt/presentation/stream/{id}

Response: Server-Sent Events stream
event: response
data: {"type": "chunk", "chunk": "..."}

event: response
data: {"type": "complete", "presentation": {...}}
```

See `PRESENTON_ASYNC_FLOW.md` for complete flow details.

### Get Presentation
```
GET /api/v1/ppt/presentation/{id}
```

### Export PPTX/PDF
```
GET /api/v1/ppt/pptx-slides/{id}/export
GET /api/v1/ppt/pdf-slides/{id}/export
```

## Configuration

### Environment Variables

Your `.env` should have (likely already present):

```bash
# Database (shared)
POSTGRES_USER=your-user
POSTGRES_PASSWORD=your-password
POSTGRES_DB=your-database

# Authentication (shared)
SECRET_KEY=your-secret-key

# LLM Providers
OPENAI_API_KEY=your-openai-key
GOOGLE_API_KEY=your-google-key

# Optional
PRESENTON_API_PORT=8001
```

### Service Resources

- **CPU**: 2.0 cores limit, 1.0 core reserved
- **Memory**: 4GB limit, 2GB reserved

## Troubleshooting

### Service Won't Start
```bash
docker compose logs presenton-api
docker compose ps db backend  # Check dependencies
```

### Database Connection
```bash
docker compose exec presenton-api env | grep DATABASE_URL
# Should show: postgresql+asyncpg://user:pass@db:5432/dbname
```

### API Not Responding
```bash
curl http://localhost:8001/api/v1/ppt/presentation/all
docker compose logs -f presenton-api
```

## Files Reference

- `Dockerfile.api-only` - Minimal API-only Dockerfile
- `docker-compose.yml` - Service definition (line 289-347)
- `SYSTEM_DESIGN_REVIEW.md` - Critical decisions and gaps analysis (includes Decision Matrix)
- `PRESENTON_ASYNC_FLOW.md` - Detailed SSE streaming implementation guide
- This file - Complete integration plan

## Decision Summary (POC)

| Decision | Choice | Reason |
|----------|--------|--------|
| **API Only** | ✅ Yes | No frontend needed |
| **Database** | ✅ Shared PostgreSQL | Consistent with existing setup |
| **Auth** | ✅ Via Backend | Centralized, secure |
| **Frontend Integration** | ✅ Backend as middleman | User context, SSE streaming |
| **User Association** | ✅ User only (no workspace/notebook) | POC simplicity |
| **Async Pattern** | ✅ SSE streaming | Real-time updates, no timeouts |
| **File Storage** | ✅ Copy to MinIO after generation | Consistent with existing pattern |
| **Scaling** | ⏸️ Deferred | POC focus |
| **Cleanup** | ⏸️ Deferred | Future: max slides limit |
| **Monitoring** | ✅ Minimal logging | Quick debugging only |

## ⚠️ Critical Decisions & Gaps

**🔴 IMPORTANT**: Review `SYSTEM_DESIGN_REVIEW.md` for critical system design decisions and gaps before proceeding.

### Key Issues Identified (POC Focus):

1. ✅ **File Storage Strategy** - Copy to MinIO after generation
2. ✅ **User Association** - Presentation data model (user_id only)
3. ✅ **Async Operations** - SSE streaming (see `PRESENTON_ASYNC_FLOW.md`)
4. ✅ **File Serving** - MinIO presigned URLs
5. ⏸️ **Rate Limiting** - Deferred for POC

### Simplified for POC:

- ❌ No workspace/notebook association needed
- ❌ No cleanup strategy (deferred)
- ❌ No scaling considerations (deferred)
- ✅ Minimal monitoring (basic logging only)

See `SYSTEM_DESIGN_REVIEW.md` for detailed analysis and recommendations.

