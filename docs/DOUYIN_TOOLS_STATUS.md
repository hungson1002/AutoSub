# Douyin tools integration

## Implemented surface

Inside **Tìm video Douyin → Dữ liệu & tương tác**, 30 named operations call the installed DouYin_Spider. Video search remains its own tab with saved Windows-encrypted cookies.

- User/live search, profile, works, media detail.
- Comments and replies, followers/following, liked videos (subject to account visibility).
- Collection list, notices, feed.
- Live information, currently promoted products, product comments and rating counts.
- Like/unlike, collect/uncollect, move/remove collection, publish/reply comment.
- Live like/chat; open conversation and send text message.
- Bounded 20-second live event and inbox event capture (not continuous monitoring or old message history).
- JSON export; works can be forwarded to existing download tab.

## Safety and verification

Operations require local access, use the stored cookie server-side, and suppress upstream logs. Writes require explicit confirmation plus a unique request ID, have no automatic retry, and duplicate IDs are refused within a backend process lifetime. After timeout/restart, inspect external state before resubmitting. No real write operation was executed during development. JSON results recursively omit session/credential fields.

TypeScript and mock tests cover validation, route origin protection, response redaction, dispatch signatures and text-message mapping. User/live searches tested live successfully. Remaining endpoints depend on account privileges and upstream behavior; wiring is not a claim of end-to-end verification.

## Not implemented / upstream limitations

- Full continuous live/inbox dashboard and reconnection UI.
- Message attachment upload (image/video/file), advanced stickers/share cards.
- Voice sending: upstream explicitly raises NotImplementedError without a compatible captured client payload; do not advertise it as supported.
- Complete conversation history: upstream `get_conversation_list` documents it only retrieves one conversation's information, not message history.
- Native XLSX export; JSON export is available.

No automatic CAPTCHA handling, bulk messaging, interaction loops, or private-data access bypass.
