# WhatsApp sign-in codes (AiSensy)

Phone sign-in and sign-up codes are delivered over WhatsApp through AiSensy's
Campaign API. SMS was never wired and is not planned: transactional SMS in India
needs DLT registration — a sender ID and per-template approval — which is
procurement with a lead time, while the WhatsApp template is approved on the
AiSensy side.

## What the code does

| Where | What |
| --- | --- |
| `apps/api/src/modules/comms/whatsapp.ts` | The only place the API calls AiSensy. Payload mirrors the Sportagon FMS edge functions. |
| `apps/api/src/modules/iam/signin.routes.ts` | `deliverPhoneOtp()` — WhatsApp when configured, the SMS stub otherwise. |
| `apps/api/src/config/env.ts` | `AISENSY_*`, `OTP_PHONE_COUNTRY_CODE`, and the production refusals. |

Nothing else sends a phone code; `POST /api/auth/otp/send` is the single entry point,
used by sign-in, sign-up phone verification and password reset alike.

## Configuration

```
AISENSY_API_KEY=                 # AiSensy Dashboard > Settings > API & Webhook
AISENSY_OTP_CAMPAIGN=otp         # the live campaign bound to the approved template
AISENSY_API_URL=https://backend.aisensy.com/campaign/t1/api/v2
OTP_PHONE_COUNTRY_CODE=91
```

**Leave `AISENSY_API_KEY` empty in development.** The phone path then falls back to
the SMS stub, which logs the code and returns it in the response as `dev_code`
(`OTP_SMS_BYPASS`, on by default). Set the key locally only when you mean to send a
real message.

## The template

Campaign `otp`, a Meta **authentication** template:

```
{{1}} is your verification code. For your security, do not share this code.
[ Copy code ]
```

The code goes out **twice** — once as `templateParams[0]` and once as the copy-code
button's parameter. Meta requires both; sending only the body variable makes AiSensy
answer HTTP 200 while WhatsApp silently drops the message.

This is the one place the payload departs from the FMS functions, which append button
values to `templateParams` under AiSensy's continuous `{{N+1}}` numbering and post
`buttons: []`. That convention is for the **dynamic URL** buttons in their utility
templates; a copy-code button on an authentication template takes the structured
button component instead. **Confirmed delivered to a handset on 2026-10-10** with the
structured shape, so it is settled — but if a send is ever accepted and never arrives,
this is the first thing to re-check against the template as AiSensy has it.

## Deploying it

The Lambda deploy script leaves an existing function's environment alone, so the key
has to be set once, directly:

```bash
aws lambda update-function-configuration \
  --function-name semp-api --region ap-south-1 \
  --environment '{"Variables":{ ...every existing variable..., "AISENSY_API_KEY":"<key>","AISENSY_OTP_CAMPAIGN":"otp"}}'
```

`--environment` **replaces** the whole variable map, so read the current one first
(`aws lambda get-function-configuration --function-name semp-api --region ap-south-1
--query 'Environment.Variables'`) and send it back with the two new keys added.
`deploy-lambda.sh` carries `AISENSY_API_KEY` through a `DEPLOY_ENV=1` deploy when it
is present in `apps/api/.env`, and omits it when it is not, so a deploy from a machine
without the key cannot blank it on the live function.

## Known failure modes

- **`{"name":"ERR401","message":"Unauthorized"}`** — the key is not authorized for
  the Campaign API. This is per-account, not purely per-plan: the Sportagon key
  (`activePlan: FREE_FOREVER`, issued 2026-04-14) **is** authorized and verified
  against the live endpoint, while a FruitFuel key on the same nominal plan was not.
  Nothing in the code can work around it — the account has to be enabled.
- **HTTP 200 with a falsy `success`** — accepted but not delivered: campaign not
  live, template/parameter mismatch, or (on a test tenant) a recipient that is not
  whitelisted. `aisensyDelivered()` treats this as a failure precisely because it
  otherwise looks identical to a successful send. Note the live endpoint answers
  with the **string** `"true"`, not a boolean (`{"success":"true",
  "submitted_message_id":"…"}`), so the check tests both spellings of false.
- **A delivery failure returns `502 OTP_DELIVERY_FAILED`** to the caller rather than
  a cheerful `sent: true`. A code nobody receives is worse than an error: the person
  waits, asks for another, and spends the window.

## Production

`config/env.ts` refuses to boot with `NODE_ENV=production` unless
`AISENSY_API_KEY` is set and both `OTP_SMS_BYPASS` and `AUTH_EMAIL_BYPASS` are off —
with a bypass on, anyone who can call `/auth/otp/send` can read the code it just
issued, which is a sign-in as anyone they like. Note that email delivery is still
unwired, so `AUTH_EMAIL_BYPASS=false` currently makes the email path throw: phone
sign-in is production-ready ahead of email, not alongside it.
