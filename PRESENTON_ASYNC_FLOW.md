# How Presenton Handles Long-Running Operations

## Presenton's Solution: Server-Sent Events (SSE) Streaming

Presenton uses **Server-Sent Events (SSE)** for real-time streaming, not polling. This is more efficient and provides better UX.

## Complete Flow

### Step 1: Create Presentation (Quick)
```typescript
POST /api/v1/ppt/presentation/create
Body: {
  content: "Topic",
  n_slides: 8,
  language: "English",
  ...
}

Response: {
  id: "presentation-uuid"
}
```
- Returns immediately (outline generation is fast)
- Creates presentation record in database

### Step 2: Prepare Presentation (Quick)
```typescript
POST /api/v1/ppt/presentation/prepare
Body: {
  presentation_id: "uuid",
  outlines: [...],
  layout: {...}
}

Response: PresentationModel
```
- Stores outlines and layout structure
- Prepares for streaming
- Returns immediately

### Step 3: Stream Presentation (Long-Running, SSE)
```typescript
GET /api/v1/ppt/presentation/stream/{id}
→ Server-Sent Events stream
```

**Frontend Implementation:**
```typescript
const eventSource = new EventSource(
  `/api/v1/ppt/presentation/stream/${presentationId}`
);

eventSource.addEventListener("response", (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case "chunk":
      // Accumulate JSON chunks as slides are generated
      accumulatedChunks += data.chunk;
      // Parse and update UI with partial data
      updateSlides(parseJSON(accumulatedChunks));
      break;
      
    case "complete":
      // All slides generated
      dispatch(setPresentationData(data.presentation));
      eventSource.close();
      break;
      
    case "error":
      // Handle error
      eventSource.close();
      break;
  }
});
```

**Backend Streaming:**
```python
# Presenton streams slides as they're generated
yield SSEResponse(
    event="response",
    data=json.dumps({"type": "chunk", "chunk": '{ "slides": [ '})
).to_string()

# For each slide as it completes:
yield SSEResponse(
    event="response", 
    data=json.dumps({"type": "chunk", "chunk": slide_json})
).to_string()

# When complete:
yield SSECompleteResponse(
    key="presentation",
    value=presentation_data
).to_string()
```

## Key Benefits

1. **Real-time Updates** - See slides as they're generated
2. **No Timeout Issues** - SSE connection stays open
3. **Better UX** - Progressive loading, immediate feedback
4. **No Polling Overhead** - Server pushes updates
5. **Efficient** - Single connection, no repeated requests

## Alternative: Synchronous Generation

Presenton also has a synchronous endpoint:

```
POST /api/v1/ppt/presentation/generate
→ Waits for complete generation (2-5 minutes)
→ Returns final result
```

**Note**: This will timeout in most frontend environments!

## For Our Integration

### Option 1: Follow Presenton's Pattern (Recommended)

**Three-Step Approach:**
1. Create presentation (quick)
2. Prepare presentation (quick)
3. Stream presentation (SSE)

**Backend Implementation:**
```python
# Step 1: Create
@router.post("/presentations/create")
async def create_presentation(...):
    # Call Presenton create endpoint
    # Return presentation_id

# Step 2: Prepare  
@router.post("/presentations/{id}/prepare")
async def prepare_presentation(...):
    # Call Presenton prepare endpoint
    # Return prepared presentation

# Step 3: Stream (proxy SSE)
@router.get("/presentations/{id}/stream")
async def stream_presentation(...):
    # Proxy SSE stream from Presenton
    # Forward events to frontend
```

**Frontend Implementation:**
```typescript
// Create presentation
const { id } = await createPresentation(...);

// Prepare presentation
await preparePresentation(id, outlines, layout);

// Stream presentation
const eventSource = new EventSource(
  buildBackendUrl(`presentations/${id}/stream`)
);
```

### Option 2: Simplified Synchronous (If SSE Too Complex)

Use synchronous endpoint with longer timeout:
```python
@router.post("/presentations/generate")
async def generate_presentation(...):
    async with httpx.AsyncClient(timeout=600.0) as client:
        response = await client.post(
            f"{PRESENTON_API_URL}/api/v1/ppt/presentation/generate",
            json=request,
        )
        return response.json()
```

**But**: Frontend still needs async handling (request will timeout)

## Recommendation

**Use Presenton's SSE streaming approach** - it's proven, efficient, and provides the best UX.

For our backend proxy, we can:
- Proxy the SSE stream directly to frontend
- Or implement our own SSE endpoint that calls Presenton

Either way, frontend uses EventSource API for real-time updates.

