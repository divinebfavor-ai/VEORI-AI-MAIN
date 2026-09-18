-- A generated creative is one package: the image brief, the video script and the
-- organic companion come from one angle and one driver and are only meaningful
-- together. Splitting them into separate rows would let one be served without the
-- compliance screen the others passed.
-- Applied to production 2026-09-18.

alter table public.ad_creatives drop constraint if exists ad_creatives_asset_type_check;

alter table public.ad_creatives add constraint ad_creatives_asset_type_check
  check (asset_type in ('package','image','video_script','ad_copy','landing_copy','organic_post'));
