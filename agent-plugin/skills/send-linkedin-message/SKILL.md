---
name: send-linkedin-message
description: Send a written outreach text on LinkedIn through the browser - as a connection request with a note, a direct message, or an InMail - with permission check and bookkeeping. Use after outreach-message has produced and checked the text.
---

# Send on LinkedIn

1. `list_outreach(profile_url)`: if this person already has a `sent` record, stop. Never message twice (follow-ups are separate, and only one is allowed).
2. Open the profile URL and take a snapshot. **Check for earlier contact the app doesn't know about.** The candidate also uses LinkedIn by hand, so an empty `list_outreach` does not mean they never talked:
   - The connect button reads "Pending" / "Pendente" (an invitation is waiting): already contacted.
   - Open the "Message" / "Mensagem" overlay and read the conversation **before typing anything**. Scroll up in it. Any earlier message from the candidate (or a conversation in progress) means already contacted.
   - If you are unsure, search the candidate's inbox: `https://www.linkedin.com/messaging/` and type the person's name in "Search messages".
   If they were contacted before: do not type or send. Close the overlay, call `record_outreach(..., status: "sent", contacted_before: true, message: <the earlier message, if visible>)` and pick the next contact.
3. Choose the path:
   - **"Message" / "Mensagem" button** (1st-degree or Open Profile): use the direct message text.
   - **"Connect" / "Conectar"** (on the profile, or under "More" / "Mais"): use the connection note.
     - Click Connect, then "Add a note" / "Adicionar nota", and type the note. If LinkedIn only offers "Send without a note" because the monthly note limit was reached, send without a note only if the run allows it. Record it as `channel: "connection"` with an empty message, so a direct message can follow once they accept.
     - If LinkedIn asks for their email address to connect, skip this person.
   - **Only "Follow"**, or InMail needs credits you don't have: skip and pick the next contact.
4. Paste the text and check that it's in the box in full (with no line breaks lost and no truncation at the limit).
5. `request_permission(kind: "message", job_id, profile_url, summary: "<who> - <first 80 chars>")`. Only if it's allowed, click "Send" / "Enviar" (or "Send invitation" / "Enviar convite").
6. Confirm it went out: the message appears in the thread, or the button changes to "Pending" / "Pendente". Close the message overlay.
7. `record_outreach(job_id, name, profile_url, role, channel, message, status: "sent")`. If it failed, record `status: "failed"` with the reason in `notes`.

## Limits and safety

- Free LinkedIn accounts get only a handful of personalized connection notes per month, and weekly invitation limits apply. If you see a limit warning, stop sending for this run and record it.
- At most the run's message limit. `request_permission` enforces it.
- Wait 20-60 seconds between sends. Never send to more than 3 people at the same company in a run.
