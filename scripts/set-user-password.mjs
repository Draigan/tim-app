#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { stdin as input, stdout as output, exit } from 'node:process'
import readline from 'node:readline'

// Edit these two values, then run:
// npm run set-password
const TARGET_EMAIL = 'd@d.d'
const TARGET_ROLE = 'superuser'

const ENV_FILES = ['.env.booking-test', '.env.local']
const PASSWORD_MIN_LENGTH = 12

function loadEnvFile(path) {
  try {
    const env = {}
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue

      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
    return env
  } catch {
    return {}
  }
}

function mergedEnv() {
  return Object.assign({}, ...ENV_FILES.map(loadEnvFile), process.env)
}

function passwordPolicyError(password) {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter'
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter'
  if (!/[0-9]/.test(password)) return 'Password must include a number'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a symbol'
  return null
}

function hiddenPrompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input, output, terminal: true })
    const onData = char => {
      char = char.toString()
      if (char === '\n' || char === '\r' || char === '\u0004') return
      output.clearLine(0)
      output.cursorTo(0)
      output.write(question + '*'.repeat(rl.line.length))
    }

    input.on('data', onData)
    rl.question(question, answer => {
      input.off('data', onData)
      rl.close()
      output.write('\n')
      resolve(answer)
    })
  })
}

async function readJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

function responseError(body, fallback) {
  return body.error_description || body.msg || body.message || body.error || body.raw || fallback
}

const env = mergedEnv()
const supabaseUrl = env.SUPABASE_URL || env.APP_SUPABASE_URL || env.VITE_SUPABASE_URL
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.APP_SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase URL or service-role key. Expected .env.booking-test or exported env vars.')
  exit(1)
}

if (!TARGET_EMAIL || !TARGET_ROLE) {
  console.error('Set TARGET_EMAIL and TARGET_ROLE at the top of this script.')
  exit(1)
}

const password = await hiddenPrompt(`New password for ${TARGET_EMAIL}: `)
const confirmPassword = await hiddenPrompt('Confirm password: ')

if (password !== confirmPassword) {
  console.error('Passwords do not match.')
  exit(1)
}

const passwordError = passwordPolicyError(password)
if (passwordError) {
  console.error(passwordError)
  exit(1)
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
}

const usersRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000`, { headers })
const usersBody = await readJson(usersRes)
if (!usersRes.ok) {
  console.error(responseError(usersBody, 'Could not list users.'))
  exit(1)
}

const users = Array.isArray(usersBody) ? usersBody : usersBody.users
const user = users?.find(u => u.email?.toLowerCase() === TARGET_EMAIL.toLowerCase())
if (!user) {
  console.error(`User not found: ${TARGET_EMAIL}`)
  exit(1)
}

const updateRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user.id}`, {
  method: 'PUT',
  headers,
  body: JSON.stringify({
    password,
    email_confirm: true,
    app_metadata: { ...(user.app_metadata ?? {}), role: TARGET_ROLE },
  }),
})
const updateBody = await readJson(updateRes)
if (!updateRes.ok) {
  console.error(responseError(updateBody, 'Could not update password.'))
  exit(1)
}

console.log(`Updated password for ${TARGET_EMAIL}.`)
