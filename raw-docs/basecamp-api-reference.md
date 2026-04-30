# Basecamp API Reference

**Source:** https://github.com/basecamp/bc3-api
**Captured:** 2026-03-09

---

## Overview

- REST-style API, JSON serialization
- OAuth 2.0 authentication (one-time setup per account)
- Rate limit: 50 requests per 10 seconds per IP
- Free accounts have project limits; paid accounts have unlimited projects

---

## Key Endpoints for Our Use Case

### Create a Project

**Endpoint:** `POST /projects.json`

| Field | Required | Description |
|---|---|---|
| name | Yes | Project name |
| description | No | Additional project info |

**Response:** `201 Created` with project JSON (includes project ID, message board ID, vault ID, etc.)
find ~ -path "*/NexsanLegal/.git/HEAD.lock" -delete
```shell
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Smith & Associates CPA - Website Build","description":"Website development onboarding"}' \
  https://3.basecampapi.com/$ACCOUNT_ID/projects.json
```

---

### Create a Message (post intake summary)

**Endpoint:** `POST /buckets/{project_id}/message_boards/{board_id}/messages.json`

| Field | Required | Description |
|---|---|---|
| subject | Yes | Message title |
| status | Yes | Set to `"active"` to publish immediately |
| content | No | Rich HTML body (supports `<bc-attachment>` tags for embedded files) |
| category_id | No | Message type ID |
| subscriptions | No | Array of people IDs to notify (defaults to all project members) |

**Response:** `201 Created` with message JSON

---

### Upload a File (two-step process)

#### Step 1: Create an Attachment

**Endpoint:** `POST /attachments.json?name={filename}`

- Request body: raw binary file data
- Required headers: `Content-Type`, `Content-Length`
- **Response:** `201 Created` with `attachable_sgid` (needed for step 2)

```shell
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/pdf" \
  -H "Content-Length: 12345" \
  --data-binary @intake-summary.pdf \
  "https://3.basecampapi.com/$ACCOUNT_ID/attachments.json?name=intake-summary.pdf"
```

#### Step 2: Create an Upload in a Vault

**Endpoint:** `POST /buckets/{project_id}/vaults/{vault_id}/uploads.json`

| Field | Required | Description |
|---|---|---|
| attachable_sgid | Yes | From Step 1 response |
| description | No | HTML description |
| base_name | No | Filename without extension |

**Response:** `201 Created` with upload JSON

---

### Attach Files to Messages

Use `<bc-attachment>` tags in the message `content` HTML field, referencing the `attachable_sgid` from the attachment upload.

---

## Our Automated Flow

1. Generate PDF summary of collected intake data
2. Save PDF to our database/storage
3. `POST /projects.json` — create the client's Basecamp project
4. `POST /attachments.json` — upload the PDF (get `attachable_sgid`)
5. `POST /attachments.json` — upload any client logos/photos (get `attachable_sgid` for each)
6. `POST /message_boards/{id}/messages.json` — post the intake summary with PDF attached via `<bc-attachment>`
7. `POST /vaults/{id}/uploads.json` — add PDF + logos to the project vault for easy access
