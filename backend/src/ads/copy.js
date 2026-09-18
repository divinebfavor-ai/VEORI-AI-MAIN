// ─── Copy fragments ──────────────────────────────────────────────────────────
// The words the system is allowed to use for each situation, written once and
// reviewable. Hooks are composed from these plus facts taken from the operator's
// own records. Nothing is generated from a model, so no sentence can appear that
// nobody approved, and every variable substituted in is a number Veori can show
// the source of.

const ANGLE_COPY = {
  inherited: {
    subject: 'the house you inherited',
    burden: 'a house you never chose to own',
    they_say: 'I don’t even live near it and I don’t know where to start',
    objection: 'you think you have to clear it out before anyone will look at it',
    after: 'the week it stops being yours',
    permission: 'You do not have to sort through any of it.',
    waiting: 'insurance, utilities and the lawn keep running while the estate settles',
    one_step: 'a conversation about what is actually in the house, and what happens to it',
  },
  pre_foreclosure: {
    subject: 'the letters from the lender',
    burden: 'a date you did not choose',
    they_say: 'I just need to know how much time I actually have',
    objection: 'you think anyone who calls about this is trying to take the house',
    after: 'the morning there is nothing scheduled',
    permission: 'Nobody has to come to the house, and there is no sign in the yard.',
    waiting: 'fees and interest are added every month the balance sits',
    one_step: 'a call where we work out what your dates actually are',
  },
  tax_delinquent: {
    subject: 'the tax balance on the property',
    burden: 'a number that grows on its own',
    they_say: 'it was one year and now it is three',
    objection: 'you assume the balance has to be cleared before you can sell',
    after: 'the day the county stops adding to it',
    permission: 'The balance does not have to be paid before you sell.',
    waiting: 'penalties and interest are added to the balance every year it stands',
    one_step: 'a look at what is owed and what the property is worth against it',
  },
  tired_landlord: {
    subject: 'the rental that stopped being worth it',
    burden: 'a property that only calls when something is wrong',
    they_say: 'I am done with the 11pm phone calls',
    objection: 'you think you have to get the tenant out first',
    after: 'the first month with no repair to schedule',
    permission: 'The tenant can stay. That is our problem, not yours.',
    waiting: 'each turnover, vacancy and repair comes out of the same pocket',
    one_step: 'a number on the property as it is, tenant and all',
  },
  vacant: {
    subject: 'the empty house',
    burden: 'a building you pay to keep standing',
    they_say: 'it has been sitting there for two years and I keep meaning to deal with it',
    objection: 'you think it is too far gone for anyone to want',
    after: 'the month the bills for it stop',
    permission: 'It does not need to be cleaned, cleared or secured first.',
    waiting: 'insurance, taxes and weather all keep working on an empty house',
    one_step: 'someone walking it once and telling you what it is worth as it stands',
  },
  out_of_state: {
    subject: 'the property you own from another state',
    burden: 'a house you cannot drive to',
    they_say: 'I am managing it from four hundred miles away and it is not working',
    objection: 'you assume you would have to fly out to sell it',
    after: 'the week it is no longer on your list',
    permission: 'You do not have to travel. It can be done entirely remotely.',
    waiting: 'every problem costs more when you are handling it by phone',
    one_step: 'a call, then everything else by email and courier',
  },
  condition: {
    subject: 'the work the house needs',
    burden: 'a repair list longer than the house is worth to you',
    they_say: 'the last person told me I would have to fix it before it would sell',
    objection: 'you have been told the house is not sellable as it is',
    after: 'the day it is someone else’s repair list',
    permission: 'Nothing gets fixed, cleaned or staged. Not one thing.',
    waiting: 'the list gets longer and more expensive every season it waits',
    one_step: 'one walkthrough with no cleaning up beforehand',
  },
  relocation: {
    subject: 'the house you are leaving',
    burden: 'two housing costs and one income',
    they_say: 'I start the new job in six weeks and the house is still here',
    objection: 'you think a fast sale means a bad number',
    after: 'the week you are only paying for one place',
    permission: 'You can pick the closing date, including one after you have gone.',
    waiting: 'every month of overlap is a mortgage you are paying for a house you left',
    one_step: 'a date first, then the number that fits it',
  },
  failed_listing: {
    subject: 'the listing that expired',
    burden: 'six months of showings and nothing to show for it',
    they_say: 'we had two offers fall through and I am not doing that again',
    objection: 'you assume this is another buyer who will renegotiate at the end',
    after: 'a closing that actually closes',
    permission: 'No showings, no open houses, no sign.',
    waiting: 'a property that has sat on the market reads as a problem to the next buyer',
    one_step: 'a number, in writing, and the list of what could change it',
  },
  high_equity: {
    subject: 'the house that is paid off',
    burden: 'money sitting in a building that does nothing',
    they_say: 'I am not in a hurry, I just want to know it is a real number',
    objection: 'you expect an investor number to be an insult',
    after: 'the day the equity is in your account instead of the walls',
    permission: 'Nothing here is time-limited. Take the number to anyone you like and come back if it still stands up.',
    waiting: 'nothing is forcing this, which is exactly why the number has to be worth it',
    one_step: 'the arithmetic behind the number, written out',
  },
};

// A hook style is a shape. Each returns a sentence built from the fragments and
// from proof taken from records. A style that requires evidence returns null when
// the evidence is not there, and the system moves to the next style rather than
// making something up.
const HOOK_BUILDERS = {
  specific_situation: ({ c }) => `If ${c.subject} is the reason nothing has moved, that is the part we handle.`,
  permission: ({ c }) => `${c.permission} That is not a concession, it is how this works.`,
  question_they_ask: ({ c }) => `“${c.they_say}.” If that is where you are, start here.`,
  named_objection: ({ c }) => `You will not call because ${c.objection}. Fair. Here is what actually happens instead.`,
  after_picture: ({ c }) => `Picture ${c.after}. Everything below is how that happens.`,
  cost_of_waiting: ({ c }) => `Waiting is not free: ${c.waiting}.`,
  plain_number: ({ c, proof }) => {
    if (!proof.closings.usable) return null;
    return `${proof.closings.value} houses bought here, ${proof.median_days.usable ? `median ${proof.median_days.value} days from first call to closing` : 'each one on the seller’s own timeline'}. ${c.subject} is the kind we buy.`;
  },
};

// The five parts of a video. Fixed architecture: an operator who follows it gets
// the same structure every time, which is what makes results comparable.
const VIDEO_PARTS = [
  { part: 1, name: 'Hook', seconds: '0-3', job: 'Stop the scroll with the situation, not with an offer.', rule: 'No logo, no name, no "we buy". The first frame is already about them.' },
  { part: 2, name: 'Situation', seconds: '3-10', job: 'Show you understand the specific position they are in.', rule: 'Describe the circumstance without describing the person. Never diagnose them.' },
  { part: 3, name: 'Turn', seconds: '10-20', job: 'Remove the obstacle they assume is in the way.', rule: 'One obstacle only. The one this angle is built on.' },
  { part: 4, name: 'Proof', seconds: '20-35', job: 'Give them something checkable.', rule: 'Only figures that exist in the operator’s records. If there are none, this part is the process, stated plainly, not a claim.' },
  { part: 5, name: 'Ask', seconds: '35-45', job: 'One action, and what happens after it.', rule: 'Describe the ending where they say no. That is what makes the ask safe to take.' },
];

module.exports = { ANGLE_COPY, HOOK_BUILDERS, VIDEO_PARTS };
