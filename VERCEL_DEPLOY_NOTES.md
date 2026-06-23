# Deploying to Vercel

This backend is a normal long-running Express app (`src/server.js` calls
`app.listen()`), which is **not** how Vercel runs Node code. Vercel executes
serverless functions, so this project now also includes:

- `api/index.js` — a serverless handler that wraps the Express app
  (`src/app.js`) and lazily connects to MongoDB on first request, reusing the
  connection across warm invocations.
- `vercel.json` — rewrites every request to `api/index.js` so routes like
  `/api/health`, `/api/auth/...`, `/api/listings/...` all reach the Express
  app.

`src/server.js` is unchanged and still works for local development
(`npm run dev` / `npm start`) — it's just not what runs on Vercel.

## Required environment variables (Vercel → Project → Settings → Environment Variables)

- `MONGO_URI` (and optionally `MONGO_DB_NAME`)
- `GEMINI_API_KEY` (and `GEMINI_IMAGE_API_KEY` / `GEMINI_IMAGE_MODEL` if used)
- `CORS_ORIGIN` — set to your frontend's URL
- Any auth/JWT secrets used by `src/middleware/auth.js` / `src/services/authService.js`

If `MONGO_URI` is missing, `/api/health` will still respond (it doesn't touch
the DB), but any route that needs Mongo will return a clear 500 instead of
crashing the whole function.

## Known limitation: file uploads

`src/middleware/upload.js` uses `multer.diskStorage()` to write into the local
`uploads/` folder, and `src/app.js` serves that folder with
`express.static()`. Vercel's filesystem is **read-only** outside of `/tmp`,
and `/tmp` is wiped between invocations / not shared across function
instances. This means:

- Uploaded files will not persist or be reliably served back.
- This is a separate problem from the original crash and needs its own fix —
  e.g. switch `upload.js` to upload directly to S3 / Cloudinary / Vercel Blob
  instead of local disk.

## Background queues

`resumePendingPhotos()` and `resumeQueuedToolJobs()` (previously run once at
server startup) are **not** invoked by the serverless handler, since there is
no persistent process to "resume" anything in. If your app depends on these
running, they'll need to be triggered another way (e.g. a Vercel Cron Job
hitting an internal endpoint, or moving this app off Vercel to a
long-running host like Render/Railway/Fly.io).
