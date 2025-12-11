import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import {
  clearPresentationData,
  setPresentationData,
  setStreaming,
} from "@/store/slices/presentationGeneration";
import { jsonrepair } from "jsonrepair";
import { toast } from "sonner";
import { MixpanelEvent, trackEvent } from "@/utils/mixpanel";

export const usePresentationStreaming = (
  presentationId: string,
  stream: string | null,
  setLoading: (loading: boolean) => void,
  setError: (error: boolean) => void,
  fetchUserSlides: () => void
) => {
  const dispatch = useDispatch();
  const previousSlidesLength = useRef(0);
  const streamInitializedRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const initializedPresentationIdRef = useRef<string | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let accumulatedChunks = "";

    const initializeStream = async () => {
      // Prevent multiple initializations for the same presentation
      if (
        streamInitializedRef.current && 
        eventSourceRef.current && 
        initializedPresentationIdRef.current === presentationId
      ) {
        console.log(`[usePresentationStreaming] Stream already initialized for presentation ${presentationId}, skipping...`);
        return;
      }
      
      // Close any existing stream before initializing a new one (different presentation)
      if (eventSourceRef.current && initializedPresentationIdRef.current !== presentationId) {
        console.log(`[usePresentationStreaming] Closing existing stream for presentation ${initializedPresentationIdRef.current} before initializing new one for ${presentationId}`);
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      console.log(`[usePresentationStreaming] Initializing stream for presentation: ${presentationId}`);
      streamInitializedRef.current = true;
      initializedPresentationIdRef.current = presentationId;
      dispatch(setStreaming(true));
      dispatch(clearPresentationData());

      trackEvent(MixpanelEvent.Presentation_Stream_API_Call);

      eventSource = new EventSource(
        `/api/v1/ppt/presentation/stream/${presentationId}`
      );
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("response", (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case "chunk":
            accumulatedChunks += data.chunk;
            try {
              const repairedJson = jsonrepair(accumulatedChunks);
              const partialData = JSON.parse(repairedJson);

              if (partialData.slides) {
                if (
                  partialData.slides.length !== previousSlidesLength.current &&
                  partialData.slides.length > 0
                ) {
                  dispatch(
                    setPresentationData({
                      ...partialData,
                      slides: partialData.slides,
                    })
                  );
                  previousSlidesLength.current = partialData.slides.length;
                  setLoading(false);
                }
              }
            } catch (error) {
              // JSON isn't complete yet, continue accumulating
            }
            break;

          case "complete":
            try {
              dispatch(setPresentationData(data.presentation));
              dispatch(setStreaming(false));
              setLoading(false);
              streamInitializedRef.current = false;
              initializedPresentationIdRef.current = null;
              if (eventSource) {
                eventSource.close();
              }
              eventSourceRef.current = null;

              // Remove stream parameter from URL
              const newUrl = new URL(window.location.href);
              newUrl.searchParams.delete("stream");
              window.history.replaceState({}, "", newUrl.toString());
            } catch (error) {
              streamInitializedRef.current = false;
              initializedPresentationIdRef.current = null;
              if (eventSource) {
                eventSource.close();
              }
              eventSourceRef.current = null;
              console.error("Error parsing accumulated chunks:", error);
            }
            accumulatedChunks = "";
            break;

          case "closing":
            dispatch(setPresentationData(data.presentation));
            setLoading(false);
            dispatch(setStreaming(false));
            streamInitializedRef.current = false;
            initializedPresentationIdRef.current = null;
            if (eventSource) {
              eventSource.close();
            }
            eventSourceRef.current = null;

            // Remove stream parameter from URL
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete("stream");
            window.history.replaceState({}, "", newUrl.toString());
            break;
          case "error":
            streamInitializedRef.current = false;
            initializedPresentationIdRef.current = null;
            if (eventSource) {
              eventSource.close();
            }
            eventSourceRef.current = null;
            toast.error("Error in outline streaming", {
              description:
                data.detail ||
                "Failed to connect to the server. Please try again.",
            });
            setLoading(false);
            dispatch(setStreaming(false));
            setError(true);
            break;
        }
      });

      eventSource.onerror = (error) => {
        const readyState = eventSource?.readyState; // 0=CONNECTING, 1=OPEN, 2=CLOSED
        const readyStateNames: Record<number, string> = {
          0: "CONNECTING",
          1: "OPEN",
          2: "CLOSED",
        };
        
        // EventSource readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
        // If it's CLOSED (2), the connection was closed (might be normal completion)
        if (readyState === EventSource.CLOSED) {
          // Don't log or treat closed connections as errors - might be normal completion
          setLoading(false);
          dispatch(setStreaming(false));
          return;
        }
        
        // If it's CONNECTING (0), it might be a connection failure (EventSource will auto-retry)
        if (readyState === EventSource.CONNECTING) {
          // Only log on first few retries to avoid spam
          // EventSource will automatically retry, so we don't need to do anything yet
          return;
        }
        
        // Only log and treat as error if we're in OPEN state and something went wrong
        if (readyState === EventSource.OPEN) {
          console.error("[usePresentationStreaming] EventSource error in OPEN state:", {
            readyState: readyState,
            readyStateName: readyStateNames[readyState] || "UNKNOWN",
            url: eventSource?.url,
          });
          streamInitializedRef.current = false;
          initializedPresentationIdRef.current = null;
          setLoading(false);
          dispatch(setStreaming(false));
          setError(true);
          if (eventSource) {
            eventSource.close();
          }
          eventSourceRef.current = null;
        }
      };
    };

    if (stream) {
      initializeStream();
    } else {
      // Reset stream initialization flag when stream param is removed
      streamInitializedRef.current = false;
      initializedPresentationIdRef.current = null;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      fetchUserSlides();
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      streamInitializedRef.current = false;
      initializedPresentationIdRef.current = null;
    };
  }, [presentationId, stream, dispatch, setLoading, setError]); // Removed fetchUserSlides from deps to prevent re-initialization
};
