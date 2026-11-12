// Prepared during implementation; execute in the final joint validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { defaultEmbeddingModel, embeddingBackendContract, embeddingDimensions, HARRIER_ID, ONNX_ID, HARRIER_QUERY_PREFIX } from '../shared/embeddingBackends';
import { prepareEmbeddingGemma2Input, reduceEmbeddingGemma2 } from '../shared/embeddingGemma2';
import onnx from '../shared/embeddingOnnxCatalog.json';
import runtimes from '../shared/runtimeCatalog.json';
import { normalizeVector } from '../shared/vectors';

test('the five targets keep native defaults and Intel never chooses unsupported ONNX', () => {
 for(const [platform,arch] of [['darwin','arm64'],['win32','x64'],['linux','x64'],['linux','arm64']]) assert.equal(defaultEmbeddingModel(platform,arch),ONNX_ID);
 assert.equal(defaultEmbeddingModel('darwin','x64'),HARRIER_ID);
 assert.equal(embeddingDimensions(HARRIER_ID,512),1024);
 assert.equal(embeddingDimensions(ONNX_ID,256),256);
 assert.ok(!runtimes.some(r=>r.platform==='win32' && r.arch==='arm64'));
 assert.equal(runtimes.find(r=>r.platform==='linux' && r.arch==='arm64')?.files[0].digest,'0ac963f7749054f1f668b2040f52f922a8a9b34cacac34f877878639ce709d5f');
});
test('ONNX manifest uses exact upstream revision, all media graphs and official digests', () => {
 assert.equal(onnx.revision,'daa72c51243991dfcaf9f9137d2c573d8f7790c0');
 assert.equal(onnx.files.reduce((s,f)=>s+f.size,0),541790748);
 assert.equal(onnx.files.find(f=>f.path==='onnx/vision_encoder_quantized.onnx_data')?.digest,'3dabd69c0a36e9a8771ad82030dde74daa5a0e02b7047a5d3f3382b1137bab89');
 assert.ok(onnx.files.every(f=>f.algorithm==='sha256' && /^[a-f0-9]{64}$/.test(f.digest)));
});
test('Nodus task templates, Matryoshka reduction and full Harrier vectors retain their contracts', () => {
 assert.equal(prepareEmbeddingGemma2Input('imagen','query'),'task: search result | query: imagen');
 assert.equal(prepareEmbeddingGemma2Input('imagen','document'),'title: none | text: imagen');
 assert.equal(HARRIER_QUERY_PREFIX,'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ');
 const vector=Array.from({length:768},(_,i)=>i+1), reduced=reduceEmbeddingGemma2([vector],1,256)[0];
 assert.equal(reduced.length,256); assert.ok(Math.abs(Math.hypot(...reduced)-1)<1e-12);
 assert.throws(()=>reduceEmbeddingGemma2([Array(767).fill(1)],1,256));
 assert.equal(normalizeVector(Array(1024).fill(1),1024).length,1024);
});
test('backend, dimensions and caption model revisions create disjoint, deterministic vector spaces', () => {
 const fingerprint=(model:string,dimensions:number,revision='v1')=>createHash('sha256').update(embeddingBackendContract(model,dimensions,revision)).digest('hex');
 assert.notEqual(fingerprint(ONNX_ID,256),fingerprint(ONNX_ID,512));
 assert.notEqual(fingerprint(ONNX_ID,512),fingerprint(HARRIER_ID,512));
 assert.notEqual(fingerprint(HARRIER_ID,512),fingerprint(HARRIER_ID,512,'v2'));
 assert.equal(fingerprint(ONNX_ID,512),fingerprint(ONNX_ID,512));
});
