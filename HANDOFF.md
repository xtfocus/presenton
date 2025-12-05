# Engineer Handoff: Presenton Integration

## 🎯 Quick Start

**Status**: Docker setup complete, ready for backend integration  

---

## 📚 Reading Order (Priority)

### 1. Read First: `INTEGRATION_PLAN.md` (15 min)
**Why**: Overview of what's done, what's next, and practical examples

**Key sections:**
- ✅ **Current Status** - What's already configured
- 🔧 **Next Steps** - Immediate actions needed
- 📐 **Architecture** - How everything connects
- 🔌 **Key API Endpoints** - What Presenton exposes

### 2. Read Second: `SYSTEM_DESIGN_REVIEW.md` (20 min)
**Why**: Understand critical decisions, gaps, and why things are designed this way

**Key sections:**
- 🚨 **Critical Decisions & Gaps** - All major design decisions
- 📋 **Decision Matrix** (lines 329-343) - Quick reference table
- 🎯 **Recommended Implementation Order** - What to build first
- 🔧 **Immediate Action Items** - Concrete tasks with code examples

### 3. Reference: `PRESENTON_ASYNC_FLOW.md` (10 min)
**Why**: When implementing SSE streaming - detailed how Presenton works

**Read when**: You're implementing the streaming endpoints

---

## ✅ What's Already Done

1. ✅ **Docker Compose Setup**
   - `presenton-api` service configured
   - Port: 8001 (configurable)
   - Shared PostgreSQL database
   - Shared SECRET_KEY for auth
   - Volume: `presenton_data` for file storage

2. ✅ **LLM Configuration**
   - OpenAI for text generation (`OPENAI_API_KEY`)
   - Google Gemini for images (`GOOGLE_API_KEY`)

3. ✅ **Dockerfile**
   - `Dockerfile.api-only` - Minimal API-only image
   - All dependencies included

4. ✅ **Documentation**
   - System design review
   - Integration plan
   - SSE flow documentation

---

## 🚀 What Needs To Be Done

### Phase 1: Critical Foundation (Week 1)

#### 1. Create Presentation Data Model
**File**: `fastapi_backend/app/models.py`

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

**Actions:**
- [ ] Add model to `models.py`
- [ ] Create table in database (table will be created automatically by SQLModel)

#### 2. Create Backend Routes
**File**: `fastapi_backend/app/api/routes/presentations.py` (new file)

**Three endpoints needed:**

1. **Create Presentation** (quick)
   ```python
   POST /api/v1/presentations/create
   → Calls Presenton create endpoint
   → Stores presentation_id in backend
   → Returns presentation_id
   ```

2. **Prepare Presentation** (quick)
   ```python
   POST /api/v1/presentations/{id}/prepare
   → Calls Presenton prepare endpoint
   → Returns prepared presentation
   ```

3. **Stream Presentation** (SSE - long running)
   ```python
   GET /api/v1/presentations/{id}/stream
   → Proxies SSE stream from Presenton
   → Real-time updates to frontend
   ```

**Reference**: See `INTEGRATION_PLAN.md` Phase 1 for complete code examples

**Actions:**
- [ ] Create route file
- [ ] Add router to main FastAPI app
- [ ] Implement create endpoint
- [ ] Implement prepare endpoint
- [ ] Implement SSE streaming proxy

#### 3. Copy Files to MinIO
**After streaming completes**, copy generated file to MinIO:

```python
# After presentation generation completes:
1. Get file from Presenton (via API or shared volume)
2. Upload to MinIO: "presentations/{user_id}/{presentation_id}.pptx"
3. Store minio_object_key in Presentation model
4. Return presigned URL to frontend
```

**Actions:**
- [ ] Add file copy logic after streaming
- [ ] Upload to MinIO
- [ ] Update Presentation model with minio_object_key
- [ ] Return presigned URL endpoint

#### 4. Basic Error Handling
**Minimal for POC:**

```python
# Handle:
- Presenton API timeout → 504 Gateway Timeout
- Presenton API error → Transform to backend error
- Generation failure → Return error with details
- Network failure → Fail fast with clear message
```

**Actions:**
- [ ] Add error handling to all endpoints
- [ ] Log errors for debugging
- [ ] Return user-friendly error messages

---

### Phase 2: Integration (Week 1-2)

#### 5. Test End-to-End Flow
**Test the complete flow:**

```bash
# 1. Start services
docker compose up -d presenton-api backend

# 2. Create presentation
curl -X POST http://localhost:8000/api/v1/presentations/create \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"content": "Test", "n_slides": 5}'

# 3. Prepare presentation
curl -X POST http://localhost:8000/api/v1/presentations/{id}/prepare \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"outlines": [...], "layout": {...}}'

# 4. Stream (test in browser with EventSource)
```

**Actions:**
- [ ] Test create endpoint
- [ ] Test prepare endpoint
- [ ] Test SSE streaming
- [ ] Verify file copy to MinIO
- [ ] Verify presigned URL works

#### 6. Minimal Logging
**Add basic logging for debugging:**

```python
import logging

logger = logging.getLogger(__name__)

# Log key events:
- Presentation creation started/completed
- Streaming started/completed
- File copy success/failure
- Errors with context
```

**Actions:**
- [ ] Add logging to key functions
- [ ] Log generation start/completion
- [ ] Log errors with context

---

## 🔧 Getting Started Steps

### Step 1: Verify Setup (5 min)

```bash
# Check services are up
docker compose ps presenton-api backend db

# Check Presenton API is accessible
curl http://localhost:8001/api/v1/ppt/presentation/all

# Check logs
docker compose logs presenton-api
```

### Step 2: Review Code Structure (10 min)

```bash
# Understand existing patterns
ls fastapi_backend/app/api/routes/
ls fastapi_backend/app/models.py

# See how other routes are structured
cat fastapi_backend/app/api/routes/files.py  # Similar file handling
```

### Step 3: Start Implementation (30 min)

1. **Create Presentation model** (follow existing model patterns)
2. **Create presentations route file** (follow existing route patterns)
3. **Add router to main app** (check `fastapi_backend/app/main.py`)

### Step 4: Test Incrementally

```bash
# After each endpoint:
# 1. Start backend
docker compose up -d backend

# 2. Test endpoint
curl http://localhost:8000/api/v1/presentations/create ...

# 3. Check logs
docker compose logs -f backend
```

---

## 📖 Key Files to Understand

### Backend Structure
```
fastapi_backend/app/
├── models.py              # Add Presentation model here
├── api/routes/
│   └── presentations.py   # Create this file (NEW)
├── api/deps.py           # Auth dependencies (already exist)
└── main.py               # Add router here
```

### Existing Patterns to Follow

1. **File Handling**: See `fastapi_backend/app/api/routes/files.py`
   - How files are stored in MinIO
   - How presigned URLs are generated

2. **Authentication**: See `fastapi_backend/app/api/deps.py`
   - `get_current_user` dependency
   - Use this for all presentation endpoints

3. **Error Handling**: See any existing route
   - HTTPException patterns
   - Error response format

### Presenton API Reference

**Base URL**: `http://presenton-api:8000` (from Docker network)

**Key Endpoints**:
- `POST /api/v1/ppt/presentation/create` - Create presentation
- `POST /api/v1/ppt/presentation/prepare` - Prepare presentation
- `GET /api/v1/ppt/presentation/stream/{id}` - SSE stream
- `GET /api/v1/ppt/presentation/{id}` - Get presentation
- `GET /api/v1/ppt/pptx-slides/{id}/export` - Export PPTX

See `INTEGRATION_PLAN.md` section "Key API Endpoints" for details.

---

## 🎯 Success Criteria

You'll know it's working when:

- [ ] ✅ Can create presentation via backend API
- [ ] ✅ Can prepare presentation with outlines/layout
- [ ] ✅ SSE stream shows real-time slide generation
- [ ] ✅ File is copied to MinIO after generation
- [ ] ✅ Can get presigned URL and download PPTX
- [ ] ✅ Presentation is associated with user in database
- [ ] ✅ Basic error handling works
- [ ] ✅ Logs show key events for debugging

---

## 🐛 Common Issues & Solutions

### Issue: Presenton API not accessible
```bash
# Check service is running
docker compose ps presenton-api

# Check network connectivity from backend
docker compose exec backend curl http://presenton-api:8000/api/v1/ppt/presentation/all

# Check logs
docker compose logs presenton-api
```

### Issue: Database connection error
```bash
# Verify DATABASE_URL in presenton-api
docker compose exec presenton-api env | grep DATABASE_URL

# Should show: postgresql+asyncpg://user:pass@db:5432/dbname
```

### Issue: SSE streaming not working
- Check browser console for EventSource errors
- Verify backend is proxying correctly
- Check Presenton logs for generation errors
- See `PRESENTON_ASYNC_FLOW.md` for SSE implementation details

### Issue: File copy to MinIO fails
- Check MinIO service is running
- Verify MinIO credentials in backend
- Check file exists in Presenton volume
- See existing file upload code in `routes/files.py` for pattern

---

## 📞 Questions?

1. **Design decisions**: See `SYSTEM_DESIGN_REVIEW.md`
2. **API details**: See `INTEGRATION_PLAN.md`
3. **SSE implementation**: See `PRESENTON_ASYNC_FLOW.md`
4. **Docker setup**: See `docker-compose.yml` (lines 289-347)

---

## 🚀 Next Steps After Phase 1

Once Phase 1 is complete:

1. **Frontend Integration** - Add UI for presentation creation
2. **Agent Integration** - Add presentation tool to notebook agent
3. **Rate Limiting** - Add per-user limits (future)
4. **Max Slides Limit** - Prevent abuse (future)

But for POC, Phase 1 is sufficient!

---

## 📝 Implementation Checklist

Copy this checklist to track your progress:

### Phase 1: Critical Foundation
- [ ] Create Presentation data model (table created automatically by SQLModel)
- [ ] Create presentations route file
- [ ] Implement create endpoint
- [ ] Implement prepare endpoint
- [ ] Implement SSE streaming proxy
- [ ] Add file copy to MinIO after generation
- [ ] Add presigned URL endpoint
- [ ] Basic error handling
- [ ] Minimal logging

### Testing
- [ ] Test create endpoint
- [ ] Test prepare endpoint
- [ ] Test SSE streaming in browser
- [ ] Verify file in MinIO
- [ ] Verify presigned URL works
- [ ] Test error cases

---

**Good luck! 🎉**

