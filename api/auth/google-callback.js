import { createGoogleAuthHandlers } from '../../server/googleAuth.js'
export const runtime = 'nodejs'
export const GET = createGoogleAuthHandlers().callback
