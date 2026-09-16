-- Live sentiment during calls. calls.live_sentiment holds the running read the Live
-- Monitor polls ({ label, score, trend, turn, signals, at }); each turn's reading is
-- also appended to sentiment_events (source 'call_turn') for the lead's history.
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS live_sentiment jsonb;
CREATE INDEX IF NOT EXISTS sentiment_events_call_idx ON public.sentiment_events (call_id, created_at) WHERE call_id IS NOT NULL;
