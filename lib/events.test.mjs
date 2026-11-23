// Events and people from register text, no network.  node lib/events.test.mjs
import assert from "node:assert/strict";
import { eventsFrom, peopleIn, sentences } from "./events.mjs";

const place = { ref: "600751", name: "Mount Morgan Mine Site", history: "The first formal mining agreement was drawn up in 1882 between Fred, Tom and Ned Morgan along with three Rockhampton businessmen; Thomas Skarrat Hall, William Knox D'arcy and William Pattison. The 1920s signalled a period of unrest at the mine, and this, combined with a fire and subsequent flooding of the underground works led to the demise of the Mount Morgan Gold Mining Company Limited in 1927. The ore was taken to the Golden Gate mine for crushing. In 1928, Adam Alexander Boyd, a former manager of the mine, formed a new company, Mount Morgan Limited." };
const ev = eventsFrom(place);
assert.equal(ev.length, 3, "the crushing sentence names no event and no person");
assert.deepEqual(ev[1].types, ["fire", "flood or weather", "strike or dispute", "closure"]);
assert.equal(ev[1].year, 1927);
assert.equal(ev[2].year, 1928);
assert.ok(ev[2].types.includes("restart") || ev[2].types.includes("ownership"));
assert.ok(ev[0].people.includes("William Knox D'arcy") && ev[0].people.includes("Ned Morgan"));
assert.equal(ev[0].source.record_id, "600751");
assert.deepEqual(peopleIn("The ore was taken to the Golden Gate mine."), [], "a working is not a person");
assert.equal(sentences("W.K. D'Arcy joined the syndicate. Then No. 3 shaft was sunk in 1890 by the company.").length, 2, "initials and No. do not split");
console.log("events and people: 9 checks ok");
