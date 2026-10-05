/**
 * Controlled acceptance site for Web testing role isolation.
 *
 * Two synthetic accounts with distinct permissions. Identity lives in an
 * HttpOnly session cookie, so a page cannot read or forge it, and every
 * response states the account it served. Cookie isolation between roles is
 * therefore observable from the site, not from the plugin's own fields.
 */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const ACCOUNTS = {
  alice: { password: 'pw-alice-1', name: 'Alice Buyer', canCreate: true, canApprove: false },
  bob: { password: 'pw-bob-2', name: 'Bob Approver', canCreate: false, canApprove: true },
}
const sessions = new Map()
const orders = new Map()

const json = (res, code, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(payload)
}
const cookieOf = req => {
  const raw = req.headers.cookie ?? ''
  const hit = raw.split(';').map(p => p.trim()).find(p => p.startsWith('sid='))
  return hit === undefined ? '' : hit.slice(4)
}
const who = req => {
  const sid = cookieOf(req)
  const name = sessions.get(sid)
  return name === undefined ? null : { name, ...ACCOUNTS[name] }
}
// The identity marker is the only thing a test may read to decide who is
// signed in. It is absent unless the request carried a session cookie, so a
// login page, an error page, or any other text cannot be mistaken for an
// account. The expected account is not part of the marker: a test compares what
// the page says against the account its confirmed environment declares.
const page = (title, body, account) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body data-webtest-account="${account}"><h1 id="page">${title}</h1>
<div id="account">${account === '' ? '未登录' : account}</div><pre id="main">${body}</pre></body>`

createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const me = who(req)
  if (url.pathname === '/login' && req.method === 'POST') {
    let raw = ''
    req.on('data', c => { raw += c })
    return req.on('end', () => {
      const form = new URLSearchParams(raw)
      const name = form.get('user') ?? ''
      const account = ACCOUNTS[name]
      if (account === undefined || account.password !== form.get('pass')) return json(res, 401, { error: '账号或密码不正确' })
      const sid = randomUUID()
      sessions.set(sid, name)
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `sid=${sid}; Path=/; HttpOnly`, 'cache-control': 'no-store' })
      res.end(JSON.stringify({ account: name, name: account.name }))
    })
  }
  if (url.pathname === '/whoami') {
    return json(res, 200, { account: me?.name ?? null, canCreate: me?.canCreate ?? false, canApprove: me?.canApprove ?? false })
  }
  // A page that states who is signed in, so a test can verify identity through
  // a real rendered page rather than by trusting free text.
  if (url.pathname === '/account') {
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }),
      res.end(page('当前账号', me === null ? '请先登录' : `可创建：${me.canCreate}｜可审批：${me.canApprove}`,
        me === null ? '' : me.name))
  }
  if (url.pathname === '/logout') {
    sessions.delete(cookieOf(req))
    res.writeHead(200, { 'set-cookie': 'sid=; Path=/; Max-Age=0' }); return res.end('{"ok":true}')
  }
  if (url.pathname === '/orders' && req.method === 'POST') {
    if (me === null) return json(res, 401, { error: '未登录' })
    if (!me.canCreate) return json(res, 403, { error: `${me.name} 无权创建订单` })
    let raw = ''
    req.on('data', c => { raw += c })
    return req.on('end', () => {
      const title = new URLSearchParams(raw).get('title') ?? ''
      const key = randomUUID().slice(0, 8)
      orders.set(key, { key, title, createdBy: me.name, approvedBy: null })
      json(res, 201, { key, title, createdBy: me.name, approvedBy: null })
    })
  }
  if (url.pathname === '/orders' && req.method === 'GET') {
    if (me === null) return json(res, 401, { error: '未登录' })
    return json(res, 200, { account: me.name, orders: [...orders.values()] })
  }
  if (url.pathname === '/orders/approve' && req.method === 'POST') {
    if (me === null) return json(res, 401, { error: '未登录' })
    if (!me.canApprove) return json(res, 403, { error: `${me.name} 无权审批` })
    let raw = ''
    req.on('data', c => { raw += c })
    return req.on('end', () => {
      const key = new URLSearchParams(raw).get('key') ?? ''
      const order = orders.get(key)
      if (order === undefined) return json(res, 404, { error: '订单不存在' })
      order.approvedBy = me.name
      json(res, 200, order)
    })
  }
  if (url.pathname === '/') {
    // A signed-out visitor gets the sign-in form, so a test drives the site the
    // way a person does rather than posting credentials at an endpoint it was
    // told about. A signed-in visitor gets the account's own capabilities.
    const body = me === null
      ? `<form method="post" action="/login" id="signin">
      <label for="user">账号</label><input id="user" name="user" autocomplete="username">
      <label for="pass">密码</label><input id="pass" name="pass" type="password" autocomplete="current-password">
      <button type="submit" id="signin-submit">登录</button>
    </form>`
      : `可创建：${me.canCreate}｜可审批：${me.canApprove}<p><a href="/orders">我的订单</a></p>`
    return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }),
      res.end(page('受控验收站点', body, me === null ? '' : me.name))
  }
  json(res, 404, { error: 'not found' })
}).listen(8902, '127.0.0.1', () => console.log('acceptance site on http://127.0.0.1:8902'))
