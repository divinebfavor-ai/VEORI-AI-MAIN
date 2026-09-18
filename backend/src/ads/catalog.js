// ─── Creative catalogue: drivers, angles, saturated language ─────────────────
// Fixed, reviewable definitions. Nothing here is generated at runtime, so two
// operators asking the same question get the same vocabulary, and a reviewer can
// read exactly what the system is allowed to say.

// ── The seven psychological drivers ─────────────────────────────────────────
// A driver is the feeling that makes someone stop scrolling. An ad has exactly
// one. Mixing them produces an ad that sounds like every other ad.
const DRIVERS = Object.freeze([
  {
    id: 'relief',
    name: 'Relief',
    core: 'The property has become a weight. The ad offers to take the weight off.',
    feels_like: 'I can stop thinking about this.',
    works_when: ['inherited', 'probate', 'vacant', 'tired_landlord', 'out_of_state', 'code_violation', 'hoarder'],
    say: ['name the specific burden', 'describe the day after it is handled', 'make the next step one step'],
    never: ['pity', 'implying the owner failed', 'urgency stacking on someone already overwhelmed'],
    risk: 'Slides into condescension if the burden is described as the owner’s fault.',
  },
  {
    id: 'certainty',
    name: 'Certainty',
    core: 'They have been let down before. The ad offers a number that does not move.',
    feels_like: 'I know exactly what happens next.',
    works_when: ['failed_listing', 'deal_fell_through', 'expired', 'fsbo', 'low_appraisal_history'],
    say: ['state what is fixed and what is not', 'name the exact sequence of steps', 'say who pays for what'],
    never: ['guaranteeing a price before seeing the property', 'promising a closing date you do not control'],
    risk: 'Becomes a promise you cannot keep. Every certainty claim must be one the operator actually controls.',
  },
  {
    id: 'speed',
    name: 'Speed',
    core: 'A date is coming. The ad offers to be finished before it arrives.',
    feels_like: 'This can be done in time.',
    works_when: ['pre_foreclosure', 'auction_date', 'tax_delinquent', 'relocation', 'job_transfer'],
    say: ['tie speed to the seller’s actual deadline', 'state the shortest honest timeline', 'say what makes it slower'],
    never: ['a day count you have not hit before', 'manufactured countdowns', 'pressure on a distressed owner'],
    risk: 'The most saturated driver in this industry. Only use it when the deadline is real and named.',
  },
  {
    id: 'control',
    name: 'Control',
    core: 'They expect to be steamrolled. The ad hands the decisions back.',
    feels_like: 'I choose.',
    works_when: ['fsbo', 'sophisticated_seller', 'landlord', 'multiple_properties', 'has_agent_history'],
    say: ['offer the choice of closing date', 'offer more than one structure', 'state that there is no obligation and mean it'],
    never: ['fake choices', 'choices that all lead to the same outcome'],
    risk: 'Empty if the operator only has one structure to offer.',
  },
  {
    id: 'dignity',
    name: 'Dignity',
    core: 'The situation is embarrassing. The ad refuses to make it more so.',
    feels_like: 'Nobody has to know, and nobody is judging.',
    works_when: ['pre_foreclosure', 'divorce_transition', 'hoarder', 'code_violation', 'deferred_maintenance', 'medical'],
    say: ['private, discreet, no signs, no showings', 'the condition is not a problem, state it plainly', 'no cleanup required'],
    never: ['listing what is wrong with the house', 'before-and-after shaming', 'photographs of distress'],
    risk: 'Naming the situation at all can shame. Describe the relief, not the circumstance.',
  },
  {
    id: 'fairness',
    name: 'Fairness',
    core: 'They assume an investor offer is a lowball. The ad shows the arithmetic.',
    feels_like: 'I can check this myself.',
    works_when: ['high_equity', 'sophisticated_seller', 'landlord', 'previously_offered', 'agent_relationship'],
    say: ['show how the number is built', 'name the costs the seller avoids', 'invite them to compare'],
    never: ['claiming to beat any offer', 'quoting a percentage of value you have not calculated'],
    risk: 'Requires real numbers. Without them this driver has nothing to stand on.',
  },
  {
    id: 'loss_aversion',
    name: 'Loss aversion',
    core: 'Doing nothing has a cost. The ad makes that cost visible without threatening.',
    feels_like: 'Waiting is not free.',
    works_when: ['pre_foreclosure', 'tax_delinquent', 'vacant', 'deferred_maintenance', 'rising_arrears'],
    say: ['state the cost of waiting in the seller’s own numbers', 'describe what changes at a known date'],
    never: ['fear of homelessness', 'implied threats', 'invented deadlines', 'anything a regulator would read as predatory'],
    risk: 'The easiest driver to abuse. Veori only allows it when the cost of waiting comes from a figure on the record (arrears, auction date, tax owed).',
  },
]);

const DRIVER_IDS = DRIVERS.map(d => d.id);
const driver = (id) => DRIVERS.find(d => d.id === id) || null;

// ── Angles ──────────────────────────────────────────────────────────────────
// An angle is the situation the ad is about. Each maps to the evidence in the
// operator's own data that proves the situation exists in this market, so an
// angle is only ever ranked on evidence, never on a hunch.
const ANGLES = Object.freeze([
  { id: 'inherited', name: 'Inherited property', signals: ['probate', 'inherited', 'estate', 'heir'], tags: ['probate', 'inherited'], flags: ['probate_case'], drivers: ['relief', 'dignity'], audience: 'Someone who did not choose to own this house.' },
  { id: 'pre_foreclosure', name: 'Behind on payments', signals: ['pre_foreclosure', 'foreclosure', 'lis_pendens', 'notice_of_default', 'arrears'], tags: ['pre_foreclosure', 'foreclosure'], flags: ['has_lis_pendens'], drivers: ['dignity', 'speed', 'loss_aversion'], audience: 'Someone with a date on a calendar they are trying to get ahead of.' },
  { id: 'tax_delinquent', name: 'Property taxes owed', signals: ['tax_delinquent', 'tax_lien', 'delinquent'], tags: ['tax_delinquent'], flags: [], drivers: ['loss_aversion', 'relief'], audience: 'An owner watching a balance grow every year.' },
  { id: 'tired_landlord', name: 'Done being a landlord', signals: ['tired_landlord', 'landlord', 'eviction', 'non_paying_tenant', 'tenant'], tags: ['tired_landlord', 'landlord'], flags: [], drivers: ['relief', 'control'], audience: 'An owner whose rental stopped being worth the phone calls.' },
  { id: 'vacant', name: 'Empty house', signals: ['vacant', 'abandoned', 'boarded'], tags: ['vacant'], flags: ['is_vacant'], drivers: ['loss_aversion', 'relief'], audience: 'An owner paying to keep an empty building standing.' },
  { id: 'out_of_state', name: 'Own it from far away', signals: ['absentee', 'out_of_state', 'out_of_area'], tags: ['absentee_owner'], flags: ['is_absentee_owner'], drivers: ['relief', 'certainty'], audience: 'An owner managing a property they cannot drive to.' },
  { id: 'condition', name: 'House needs work', signals: ['condition', 'repairs', 'fire_damage', 'hoarder', 'code_violation', 'deferred_maintenance'], tags: ['distressed_condition'], flags: [], drivers: ['dignity', 'certainty'], audience: 'An owner who has been told the house is not sellable as it is.' },
  { id: 'relocation', name: 'Moving', signals: ['relocation', 'job_transfer', 'moving', 'downsizing'], tags: ['relocation'], flags: [], drivers: ['speed', 'certainty'], audience: 'An owner with two housing costs and one income.' },
  { id: 'failed_listing', name: 'It did not sell', signals: ['expired', 'failed_listing', 'withdrawn', 'fsbo', 'fell_through'], tags: ['expired_listing', 'fsbo'], flags: [], drivers: ['certainty', 'fairness'], audience: 'An owner who already tried the normal way.' },
  { id: 'high_equity', name: 'Cash out of a paid-off house', signals: ['high_equity', 'free_and_clear', 'long_time_owner'], tags: ['high_equity'], flags: [], drivers: ['fairness', 'control'], audience: 'An owner with real money in the house and no obligation to move.' },
]);

const ANGLE_IDS = ANGLES.map(a => a.id);
const angle = (id) => ANGLES.find(a => a.id === id) || null;

// ── Saturated language ──────────────────────────────────────────────────────
// Phrases that the whole industry runs. Using them makes the operator
// indistinguishable, which is the expensive failure, not a compliance one.
// Each carries what to do instead. This list is fixed because the live
// competitor sources (Meta Ad Library, Ads Transparency) are not connected; when
// they are, market-specific saturation is added on top of this floor.
const SATURATED = Object.freeze([
  { phrase: 'we buy houses', why: 'The single most-run phrase in this industry. It identifies the operator as one of many.', instead: 'Name the situation you solve, not the transaction you want.' },
  { phrase: 'cash for your house', why: 'Interchangeable with every competitor in the feed.', instead: 'Say what the cash removes: a payment, a date, a repair bill.' },
  { phrase: 'sell your house fast', why: 'Speed with no deadline attached is noise.', instead: 'Tie the timeline to a date the seller already has.' },
  { phrase: 'any condition', why: 'Every buyer says it, so it proves nothing.', instead: 'Describe a specific condition you have actually bought.' },
  { phrase: 'any situation', why: 'Vague to the point of meaningless.', instead: 'Name one situation.' },
  { phrase: 'no fees no commissions', why: 'Table stakes, stated by everyone.', instead: 'Show the arithmetic of what the seller keeps.' },
  { phrase: 'close in 7 days', why: 'A number most operators cannot hit, so sellers have stopped believing it.', instead: 'State the timeline you have actually closed in, and what would slow it.' },
  { phrase: 'fair cash offer', why: '“Fair” asserted rather than shown.', instead: 'Show how the number is built.' },
  { phrase: 'no obligation', why: 'Universal filler.', instead: 'Say what specifically happens after they call, including the ending where they say no.' },
  { phrase: 'get your free offer today', why: 'Reads as a funnel, not a person.', instead: 'Offer a conversation with a named human.' },
  { phrase: 'stop foreclosure', why: 'Heavily run, and it foregrounds the shame.', instead: 'Speak to the outcome the owner wants, not the process they are in.' },
  { phrase: 'distressed property', why: 'Industry language. Sellers do not describe their home this way.', instead: 'Use the words the owner would use.' },
  { phrase: 'motivated seller', why: 'Investor jargon that tells the seller they are a target.', instead: 'Never address the reader as a lead type.' },
  { phrase: 'as-is', why: 'So common it no longer registers.', instead: 'Say the concrete thing: you will not ask them to fix or clean anything.' },
  { phrase: 'guaranteed offer', why: 'A guarantee before inspection is one you cannot honour.', instead: 'State what is fixed and what is contingent.' },
]);

// Hook styles the system can generate. Each is a shape, not a script.
const HOOK_STYLES = Object.freeze([
  { id: 'specific_situation', name: 'Specific situation', shape: 'Open on a circumstance narrow enough that only the right reader recognises it.' },
  { id: 'cost_of_waiting', name: 'Cost of waiting', shape: 'Open on a number that grows, taken from the record.', requires_evidence: true },
  { id: 'permission', name: 'Permission', shape: 'Open by removing an obligation the reader assumes they have.' },
  { id: 'question_they_ask', name: 'The question they already ask', shape: 'Open with the sentence the owner has said out loud to someone.' },
  { id: 'plain_number', name: 'Plain number', shape: 'Open with arithmetic the reader can check.', requires_evidence: true },
  { id: 'after_picture', name: 'The day after', shape: 'Open on the moment it is finished, not the problem.' },
  { id: 'named_objection', name: 'Their objection first', shape: 'Open by saying the reason they will not call.' },
]);

const IMAGE_FORMATS = Object.freeze([
  { id: 'exterior_ordinary', name: 'Ordinary exterior', use: 'Looks like a house on their street, not a listing photo.' },
  { id: 'document_close_up', name: 'Document close-up', use: 'A letter, a notice, a statement. Reads as real life, never a real document.' },
  { id: 'hands_keys', name: 'Hands and keys', use: 'Transfer without faces. Avoids implying who the seller is.' },
  { id: 'text_on_plain', name: 'Text on plain ground', use: 'When the sentence is the creative and an image would dilute it.' },
  { id: 'operator_portrait', name: 'The operator', use: 'A real photograph of the actual person. Never generated.' },
  { id: 'split_before_after', name: 'Side by side', use: 'Only for work the operator actually did, with their own photographs.' },
]);

module.exports = { DRIVERS, DRIVER_IDS, driver, ANGLES, ANGLE_IDS, angle, SATURATED, HOOK_STYLES, IMAGE_FORMATS };
