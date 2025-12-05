# System Design Review: Presenton API Integration

> **👋 New engineer?** Start with [`HANDOFF.md`](HANDOFF.md) for what to read and do next!

## 🚨 Critical Decisions & Gaps

### 1. File Storage Strategy ⚠️ **MAJOR GAP**

**Current State:**
- Presenton stores files in: `presenton_data:/app_data/exports/` (Docker volume)
- Backend stores files in: **MinIO** (object storage)
- No integration path between them

**Problem:**
- Generated PPTX/PDF files are in Docker volume (not accessible)
- Backend uses MinIO for file serving (presigned URLs)
- Frontend expects files via MinIO presigned URLs

**Decision:**
- ✅ **Store presentation metadata in backend, files in MinIO**
  - Unified file access
  - Consistent with Document model
  - Better for scaling

**Recommendation**: Copy generated files to MinIO after generation

---

### 2. Database Schema Isolation ⚠️ **RISK**

**Current State:**
- Presenton creates tables in shared PostgreSQL
- Tables: `presentationmodel`, `slidemodel`, `templatemodel`, etc.
- Backend has: `documents`, `users`, `workspaces`, etc.

**Risk:**
- No explicit namespace/schema separation
- Potential table name conflicts (unlikely but possible)
- Migration conflicts if Presenton updates schema

**Decision Needed:**
- [ ] Verify no table name conflicts
- [ ] Consider PostgreSQL schema separation (`presenton` schema vs `public`)
- [ ] Document Presenton's table structure

**Action Items:**
1. Check Presenton's table names against backend
2. Document Presenton schema in integration plan
3. Consider schema namespace if conflicts exist

---

### 3. User Association & Data Model ⚠️ **MISSING**

**Current State:**
- Presenton has no user association built-in
- Backend knows users, workspaces, notebooks
- No link between presentations and users

**Gap:**
- How do we know which user generated which presentation?

**Use Case:**
- Agent tool synthesizes conversation → generates slides
- User gets quick action button in message to jump to slide maker
- **No association needed** between presentation and workspace/notebook - just user

**Decision Needed:**
- [ ] **Create backend data model** for presentations:
  ```python
  class Presentation(SQLModel, table=True):
      id: UUID
      user_id: UUID  # Foreign key to User (only association needed)
      presenton_presentation_id: UUID  # Presenton's ID
      presenton_path: str  # Path in Presenton storage
      minio_object_key: Optional[str]  # If copied to MinIO
      title: Optional[str]
      created_at: datetime
      updated_at: datetime
  ```

- [ ] **Store metadata in backend** after generation
- [ ] **Presenton stores presentation**, backend stores **metadata + user context**

**Recommendation**: Create `Presentation` model in backend (user association only)

---

### 4. File Serving Architecture ⚠️ **CRITICAL**

**Current Backend Pattern:**
```python
# Files stored in MinIO
# Served via presigned URLs
@router.get("/presign")
async def get_presigned_url(key: str) -> dict:
    return {"url": minio_client.get_presigned_url(...)}
```

**Problem:**
- Presenton files are in Docker volume (`presenton_data`)
- Not accessible via MinIO presigned URLs
- No file serving endpoint
**Decision:**
- ✅ **Copy to MinIO** after generation

```python
# After Presenton generation
1. Generate presentation → Presenton returns path
2. Read file from presenton volume (via API or shared volume)
3. Upload to MinIO
4. Store object_key in backend Presentation model
5. Return presigned URL to frontend
```

**Recommendation**: Copy to MinIO after generation

---

### 5. Long-Running Operations & Timeouts ✅ **SOLUTION: SSE STREAMING**

**How Presenton Actually Handles It:**

Presenton uses **Server-Sent Events (SSE)** for streaming, not polling! This is more efficient.

**Three-Phase Approach:**

1. **CREATE Presentation** (quick, <30s)
   ```
   POST /api/v1/ppt/presentation/create
   → Returns: { id: "presentation_id" }
   → Generates outlines quickly
   ```

2. **PREPARE Presentation** (quick)
   ```
   POST /api/v1/ppt/presentation/prepare
   → Body: { presentation_id, outlines, layout }
   → Stores structure for streaming
   → Returns immediately
   ```

3. **STREAM Presentation** (long-running, SSE)
   ```
   GET /api/v1/ppt/presentation/stream/{id}
   → Server-Sent Events stream
   → Streams slides as they're generated in real-time
   ```

**Frontend Implementation:**
```typescript
// Presenton uses EventSource for SSE
const eventSource = new EventSource(
  `/api/v1/ppt/presentation/stream/${presentationId}`
);

eventSource.addEventListener("response", (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case "chunk":
      // Accumulate and update UI with partial slide data
      accumulatedChunks += data.chunk;
      updateSlides(parseJSON(accumulatedChunks));
      break;
    case "complete":
      // All slides generated
      eventSource.close();
      break;
  }
});
```

**Benefits:**
- ✅ Real-time progress (see slides as they generate)
- ✅ No polling overhead
- ✅ No timeout issues (SSE connection stays open)
- ✅ Better UX (progressive loading)
- ✅ Single connection (efficient)

**Recommendation**: **Use SSE streaming** - Follow Presenton's proven approach

See `PRESENTON_ASYNC_FLOW.md` for detailed implementation guide.

---

### 6. Error Handling & Resilience ⚠️ **GAP**

**Current State:**
- No error handling strategy documented
- No retry logic
- No circuit breaker pattern

**Gap:**
- What if Presenton API is down?
- What if generation fails mid-process?
- How to handle partial failures?

**Decision Needed:**
- [ ] **Error handling strategy**:
  ```python
  # Backend proxy should handle:
  - Presenton API timeout → 504 Gateway Timeout
  - Presenton API error → Transform to backend error
  - Generation failure → Return error with details
  - Network failure → Retry logic or fail fast
  ```

- [ ] **Retry logic**: Should we retry on failure?
- [ ] **Circuit breaker**: Prevent cascading failures

**Recommendation**: Add comprehensive error handling

---

### 7. Authentication & Authorization ⚠️ **UNRESOLVED**

**Current State:**
- Presenton API has no auth enforcement
- Backend proxy approach recommended but not implemented
- Direct Presenton access possible (security risk)

**Gap:**
- Presenton API is currently **unprotected**
- Anyone with network access can generate presentations
- No rate limiting
- No user quota enforcement

**Decision Needed:**
- [ ] **Immediate**: Don't expose Presenton API port publicly
  - Only accessible via Docker network
  - Backend-only access

- [ ] **Short-term**: Implement backend proxy with auth
  - All requests go through backend
  - Backend validates user

- [ ] **Long-term**: Add auth directly to Presenton (optional)

**Recommendation**: Backend-only access, no public port

---

### 8. Rate Limiting & Quotas ⚠️ **MISSING**

**Current State:**
- Backend has rate limiting for file uploads
- No rate limiting for presentation generation
- No per-user quotas

**Gap:**
- Users could spam presentation generation
- No cost control (OpenAI/Google API costs)
- No fair usage enforcement

**Decision Needed:**
- [ ] **Rate limiting**:
  ```python
  # Per-user rate limits
  - X presentations per hour
  - Y presentations per day
  - Z total presentations
  ```

- [ ] **Quota management**:
  - Per-user limits
  - Workspace limits
  - System-wide limits

**Recommendation**: Add rate limiting to backend proxy

---

### 9. Resource Limits & Scaling ⏸️ **DEFERRED (POC)**

**Current State:**
- Presenton API: 2 CPU cores, 4GB RAM
- Single instance
- Suitable for POC

**Note**: Scaling considerations deferred - focus on POC functionality first

---

### 10. Data Consistency & Cleanup ⏸️ **DEFERRED (POC)**

**Current State:**
- No cleanup strategy for old presentations
- Storage will grow (acceptable for POC)

**Future Consideration:**
- Prefer limiting max number of slides per user rather than deleting old files
- No cleanup needed for POC

**Note**: Cleanup strategy deferred - focus on POC functionality first

---

### 11. Monitoring & Observability ✅ **MINIMAL (POC)**

**Current State:**
- Health check endpoint exists
- Basic logging sufficient for POC

**Decision:**
- [x] **Minimal logging**: Basic error/success logs for debugging
- [x] **Quick debugging**: Simple logs to track generation issues

**Recommendation**: Keep minimal - just enough for quick debugging/tracking

---

### 12. Workspace/Notebook Integration ❌ **NOT NEEDED**

**Current State:**
- No link between presentations and notebooks/workspaces needed

**Use Case:**
- Agent tool synthesizes conversation → generates slides outlines with text content
- User gets quick action button in message to jump to slide maker
- Presentations are user-scoped only, no workspace/notebook association required

**Decision:**
- ✅ **No workspace/notebook association** needed
- ✅ **User association only** (see Section 3)

**Recommendation**: No integration needed - presentations are user-scoped only

---

## 📋 Decision Matrix

| Issue | Priority | Decision Needed | Impact |
|-------|----------|----------------|--------|
| **File Storage Strategy** | 🔴 Critical | Copy to MinIO after generation | High - Affects file access |
| **User Association** | 🔴 Critical | Create Presentation model (user only) | High - Required for user context |
| **Async Pattern** | 🔴 Critical | Use SSE streaming | High - Frontend timeout issue |
| **File Serving** | 🔴 Critical | MinIO integration | High - Frontend expects presigned URLs |
| **Database Schema** | 🟡 Medium | Verify no conflicts | Medium - Potential issues |
| **Rate Limiting** | 🟡 Medium | Per-user limits | Medium - Cost control |
| **Error Handling** | 🟡 Medium | Basic error handling | Medium - User experience |
| **Monitoring** | 🟢 Low | Minimal logging | Low - Quick debugging |
| **Scaling** | ⏸️ Deferred | Not for POC | N/A |
| **Cleanup** | ⏸️ Deferred | Future: max slides limit | N/A |
| **Workspace Integration** | ❌ Not Needed | User association only | N/A |

---

## 🎯 Recommended Implementation Order

### Phase 1: Critical Foundation (POC)
1. ✅ Docker-compose setup (DONE)
2. ⏳ **Create Presentation data model** in backend (user association only)
3. ⏳ **Implement SSE streaming pattern**
4. ⏳ **Add file copy to MinIO** after generation

### Phase 2: Integration (POC)
5. ⏳ **Backend proxy endpoints** with auth
6. ⏳ **Basic error handling**
7. ⏳ **Minimal logging** for debugging

### Phase 3: Future (Post-POC)
8. ⏳ **Rate limiting** per user
9. ⏳ **Max slides limit** per user (instead of cleanup)

---

## 🔧 Immediate Action Items

### 1. Fix File Storage (Critical)
```python
# After Presenton generates presentation:
1. Presenton returns: {"path": "/app_data/.../file.pptx"}
2. Backend reads file from shared volume or Presenton API
3. Upload to MinIO with object_key: "presentations/{user_id}/{presentation_id}.pptx"
4. Store in backend: Presentation.minio_object_key
5. Return presigned URL to frontend
```

### 2. Create Data Model (Critical)
```python
# fastapi_backend/app/models.py
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

### 3. Implement SSE Streaming Pattern (Critical)
```python
# Backend proxy should:
1. Call Presenton create endpoint
2. Call Presenton prepare endpoint
3. Proxy SSE stream from Presenton to frontend
4. On completion, copy file to MinIO
5. Store in backend Presentation model
```

---

## ⚠️ Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| File serving complexity | High | Use MinIO copy pattern (consistent with existing) |
| Frontend timeout | High | Use SSE streaming (Presenton's approach) |
| Storage growth | Low (POC) | Deferred - future: max slides limit |
| Cost control | Medium | Future: Add rate limiting and quotas |
| Database conflicts | Low | Verify schema, use namespaces if needed |

---

## 🎯 Success Criteria (POC)

- ✅ Presentations accessible via MinIO presigned URLs
- ✅ User association and tracking
- ✅ SSE streaming for async generation
- ✅ Basic error handling
- ✅ Minimal logging for debugging

---

## Next Steps

1. **Review this document** with team
2. **Make critical decisions** (file storage, data model)
3. **Create detailed implementation plan** for Phase 1
4. **Update INTEGRATION_PLAN.md** with decisions

