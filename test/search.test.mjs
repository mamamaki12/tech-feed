import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitMatches} from '../docs/search.js';
test('Title matches come first and body-only results are separate without duplicates',()=>{
 const both={title:'Claude の新機能',source:'媒体A',body:'Claude を解説'};
 const bodyOnly={title:'開発を効率化する方法',source:'媒体B',body:'Claude Code を活用します'};
 const missing={title:'別の記事',source:'媒体C'};
 const results=splitMatches([bodyOnly,missing,both],'claude');
 assert.deepEqual(results.primary,[both]);assert.deepEqual(results.body,[bodyOnly]);
 assert.deepEqual(splitMatches([bodyOnly,missing,both],'').primary,[bodyOnly,missing,both]);
});
