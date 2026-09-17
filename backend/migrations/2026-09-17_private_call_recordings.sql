-- Seller call audio must not be reachable by anyone holding a link.
-- The app stores "storage:call-recordings/<path>" and plays recordings through
-- GET /api/calls/:id/recording, which checks ownership and returns a signed URL.
update storage.buckets
   set public = false,
       file_size_limit = 104857600,              -- 100 MB per recording
       allowed_mime_types = array['audio/mpeg']
 where id = 'call-recordings';
