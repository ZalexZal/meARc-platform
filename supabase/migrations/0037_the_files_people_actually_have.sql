-- 0037 - the files people actually have
--
-- The picker on the editor says accept="image/*" and accept="audio/*", and the
-- bucket accepts nine types. Everything in the gap is chosen from the dialog,
-- uploaded, and refused by storage with invalid_mime_type - which is not a
-- sentence anybody writing a trail can act on.
--
-- The gap is not exotic. A recording made on a laptop is audio/wav or
-- audio/webm; one off an iPhone is audio/x-m4a. A clip off any phone is
-- video/quicktime, because that is what .mov is. A photo off a recent iPhone is
-- image/heic. A teacher putting a trail together the night before the twelfth
-- will hit at least one of these, and the failure looks like the site is broken
-- rather than like the file is wrong.
--
-- The bucket stays public-read and stays at 50 MB. Only the list widens, and it
-- widens to formats a browser can play: nothing here needs transcoding.
--
-- Safe to run twice.

begin;

update storage.buckets
   set allowed_mime_types = array[
         -- pictures
         'image/jpeg', 'image/png', 'image/webp', 'image/avif',
         'image/gif', 'image/heic', 'image/heif',
         -- recordings
         'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav',
         'audio/wave', 'audio/webm', 'audio/aac', 'audio/x-m4a', 'audio/flac',
         -- clips
         'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
 where id = 'marker-media';

commit;
