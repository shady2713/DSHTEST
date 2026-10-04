/** Session-target and owner eligibility checks occur in the project write queue. */
import { afterEach,expect,it,vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectId } from '@deepseek-ai/dsh-web-test-contracts'
import { cleanup,registration,startRuntime } from './harness.ts'
afterEach(cleanup)

it('refuses a correction queued after the same session selects another project',async()=>{
  const h=await startRuntime()
  try{
    const a=brandString<ProjectId>((await h.runtime.registerProject(registration('cmd-condition-a'))).resourceId)
    const b=brandString<ProjectId>((await h.runtime.registerProject(registration('cmd-condition-b'))).resourceId)
    const sessionId=SessionId('condition-session');await h.runtime.saveSessionProject(sessionId,a)
    const before=h.runtime.readProject(a),prepared=h.runtime.prepareProjectUpdate(a),guard=vi.fn()
    const selecting=h.runtime.saveSessionProject(sessionId,b)
    const updating=h.runtime.commitProjectUpdate({ commandId:'cmd-condition-update',recordId:prepared.recordId,expectedRevision:prepared.expectedRevision },prepared,{ codeRoots:['C:\\corrected'],entryUrls:['http://localhost:3000/corrected'] },{ sessionId,projectId:a,assertCurrent:guard })
    await selecting
    await expect(updating).rejects.toMatchObject({ code:'web-test/record-mismatch' })
    expect(guard).not.toHaveBeenCalled();expect(h.runtime.readProject(a)).toEqual(before)
    expect(h.runtime.readSessionProject(sessionId)).toBe(b)
  }finally{await h.stop()}
})

it('keeps staged metadata unpublished when its owner withdraws before head publication',async()=>{
  const h=await startRuntime()
  try{
    const projectId=brandString<ProjectId>((await h.runtime.registerProject(registration('cmd-publish-project'))).resourceId)
    const sessionId=SessionId('publish-session');await h.runtime.saveSessionProject(sessionId,projectId)
    const before=h.runtime.readProject(projectId),prepared=h.runtime.prepareProjectUpdate(projectId)
    let checks=0
    const assertCurrent=()=>{if(++checks===2)throw new Error('synthetic eligibility withdrawn before publication')}
    await expect(h.runtime.commitProjectUpdate({ commandId:'cmd-publish-update',recordId:prepared.recordId,expectedRevision:prepared.expectedRevision },prepared,{ codeRoots:['C:\\corrected'],entryUrls:[] },{ sessionId,projectId,assertCurrent })).rejects.toThrow('synthetic eligibility withdrawn before publication')
    expect(checks).toBe(2);expect(h.runtime.readProject(projectId)).toEqual(before)
  }finally{await h.stop()}
})
