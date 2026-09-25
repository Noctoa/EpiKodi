import { describe, expect, it } from 'vitest'
import { parsePropfind } from './http'

const XML = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/media/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/media/Films/</D:href>
    <D:propstat><D:prop>
      <D:resourcetype><D:collection/></D:resourcetype>
      <D:getlastmodified>Tue, 01 Oct 2024 10:00:00 GMT</D:getlastmodified>
    </D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/media/Mon%20Film.mkv</D:href>
    <D:propstat><D:prop>
      <D:resourcetype/>
      <D:getcontentlength>1048576</D:getcontentlength>
      <D:getlastmodified>Tue, 01 Oct 2024 12:30:00 GMT</D:getlastmodified>
    </D:prop></D:propstat>
  </D:response>
</D:multistatus>`

describe('parsePropfind', () => {
  it('lit noms, types, tailles et dates', () => {
    const entries = parsePropfind(XML, '/media/')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ name: 'Films', isDirectory: true, size: 0 })
    expect(entries[1]).toMatchObject({ name: 'Mon Film.mkv', isDirectory: false, size: 1048576 })
    expect(entries[1].mtime).toBe(Date.parse('Tue, 01 Oct 2024 12:30:00 GMT'))
  })

  it('exclut le dossier interrogé lui-même', () => {
    expect(parsePropfind(XML, '/media/').map((e) => e.name)).not.toContain('media')
  })

  it('décode les noms encodés dans les href', () => {
    expect(parsePropfind(XML, '/media').some((e) => e.name === 'Mon Film.mkv')).toBe(true)
  })

  it('tolère une réponse vide ou sans préfixe de namespace', () => {
    expect(parsePropfind('', '/')).toEqual([])
    const sansPrefixe = `<multistatus xmlns="DAV:"><response><href>/a/b.mp4</href>
      <propstat><prop><getcontentlength>12</getcontentlength></prop></propstat></response></multistatus>`
    expect(parsePropfind(sansPrefixe, '/a')).toEqual([
      { name: 'b.mp4', isDirectory: false, size: 12, mtime: 0 }
    ])
  })
})
