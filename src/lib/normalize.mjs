const CONTRACTIONS = {
  "don't": 'do not', "doesn't": 'does not', "can't": 'cannot',
  "won't": 'will not', "isn't": 'is not', "aren't": 'are not',
  "wasn't": 'was not', "weren't": 'were not', "haven't": 'have not',
  "hasn't": 'has not', "hadn't": 'had not', "couldn't": 'could not',
  "wouldn't": 'would not', "shouldn't": 'should not', "i'm": 'i am',
  "it's": 'it is', "that's": 'that is', "what's": 'what is',
  "let's": 'let us', "we're": 'we are', "they're": 'they are',
  "i've": 'i have', "we've": 'we have', "they've": 'they have',
  "i'll": 'i will', "we'll": 'we will', "they'll": 'they will',
};

export function normalize(text) {
  let t = text;
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`[^`]+`/g, ' ');
  t = t.toLowerCase();
  for (const [contraction, expansion] of Object.entries(CONTRACTIONS)) {
    t = t.replaceAll(contraction, expansion);
  }
  return t.replace(/\s+/g, ' ').trim();
}
