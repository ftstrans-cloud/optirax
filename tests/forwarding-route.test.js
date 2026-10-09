import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMapsRoute,googleMapsUrl} from '../public/forwarding-route.js';
test('Maps: path, API and legacy URLs preserve ordered waypoints and street addresses',()=>{
  assert.deepEqual(parseMapsRoute('https://www.google.pl/maps/dir/Poznań,+ul.+Długa+1/Gorzów/Berlin/@52,15,8z/data=!4m2'),{origin:'Poznań, ul. Długa 1',stops:['Gorzów'],destination:'Berlin'});
  assert.deepEqual(parseMapsRoute('https://www.google.com/maps/dir/?api=1&origin=Poznan&destination=Berlin&waypoints=Gorzow%7CFrankfurt'),{origin:'Poznan',stops:['Gorzow','Frankfurt'],destination:'Berlin'});
  assert.deepEqual(parseMapsRoute('https://maps.google.com/maps?saddr=Poznan&daddr=Gorzow+to:Berlin'),{origin:'Poznan',stops:['Gorzow'],destination:'Berlin'});
  assert.equal(googleMapsUrl('https://maps.app.goo.gl/abc').hostname,'maps.app.goo.gl');
  for(const url of ['https://google.com.evil.com/maps/dir/A/B','javascript:alert(1)','https://www.google.com/maps/place/Berlin','https://www.google.com/maps/dir/%ZZ/B'])assert.throws(()=>parseMapsRoute(url));
});
