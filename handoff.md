# Отчёт: 2026-08-14

## Что сделано

**Задача: починить B2 batch delete — добавить Content-MD5 в b2MediaDeleteObjects.**

### Изменение кода (коммит `a5f1e78`)

**`video-server/index.js:2782`** — одна новая строка и расширение `headers`:

```diff
+  const bodyMd5 = crypto.createHash('md5').update(body).digest('base64')
   const res = await fetch(fullUrl, {
     method: 'POST',
-    headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
+    headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)), 'Content-MD5': bodyMd5 },
     body,
   })
```

- MD5 вычисляется от той же строки `body`, что уходит в `fetch` — один экземпляр, нет дублирования.
- `crypto` уже объявлен на строке 44 (`const crypto = require('crypto')`), импорт не добавлялся.
- Логирование ошибок B2 не изменено.

### Проверки перед пушем

- `node --check video-server/index.js` → OK
- `node scripts/eslint.undef-check.mjs` → `no-undef: 0 errors in video-server/index.js`

### Живой тест после деплоя

```
POST https://s3.us-east-005.backblazeb2.com/youtubegen-videos?delete
Content-MD5: V/w1g2Kv6NsU+V+rorODeg==
HTTP status: 200
Response body: <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Deleted>
        <DeleteMarker>true</DeleteMarker>
        ...
        <Key>test-probe-cc/b2-md5-probe.txt</Key>
    </Deleted>
</DeleteResult>
```

HTTP 200. До фикса было HTTP 400. B2 принял заголовок и вернул `<Deleted>`.  
16 orphan-файлов в `temp/` (1,16 МБ, с прогона 14.08 04:00 UTC) будут удалены при следующем прогоне крона (15.08 04:00 UTC).

### Railway

Деплой прошёл, статус **Online** (подтверждён `railway status` после ожидания).

## Что не получилось

—

## Изменения в файлах состояния

TASKS: B2 batch delete HTTP 400 помечен `[x]`, добавлены хеш коммита и результат live-теста
CONTEXT: без изменений
WORKFLOW: без изменений

## Открытые вопросы владельцу

1. В логах вчерашнего крона `thresholds: free=undefinedh paid=undefinedh` — строка 2836 обращается к `.free` / `.paid` числа `72`. Не влияет на работу, но вводит в заблуждение. Убрать или заменить на `порог=${RETENTION_MEDIA_HOURS}h` при следующей правке функции.
2. `test-b2-delete-md5.mjs` — зонд оставлен в `scripts/`, закоммитить или удалить?
