import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraHash, readCamera, cameraInBounds } from '../public/camera-state.js';

test('camera links preserve the exact pose and reject invalid states',()=>{
  const camera={eye:[631.123456789,1.812345678,-172.987654321],yaw:2.231234567,pitch:-.23456789,speed:270,destination:'interlaken'};
  assert.deepEqual(readCamera(cameraHash(camera)),camera);
  const banked={...camera,roll:.15,speed:5000};assert.deepEqual(readCamera(cameraHash(banked)),banked);
  assert.equal(readCamera(cameraHash({...camera,roll:'bad'})),null);
  for(const hash of ['', '#camera=broken',cameraHash({...camera,eye:[1,2]}),cameraHash({...camera,pitch:8}),cameraHash({...camera,speed:0})])assert.equal(readCamera(hash),null);
  assert.equal(cameraInBounds(camera,[627,168,637,178]),true);
  assert.equal(cameraInBounds({...camera,eye:[625,2,-100]},[627,168,637,178]),false);
});
