import { expressionsTable, type InsertExpression } from "../schema";
import type { AppDatabase } from "../index";

export const expressionSeeds: InsertExpression[] = [
  { glyph: "^.^", name: "Pleased", family: "Joy", eyes: "^ ^", mouth: ".", gesture: null, valence: "Positive", arousal: "Medium", intimacy: 0, cognitiveRole: "reward-signal", notes: "Happy / pleased — a positive reward signal" },
  { glyph: "^_^", name: "Content", family: "Joy", eyes: "^ ^", mouth: "_", gesture: null, valence: "Positive", arousal: "Low", intimacy: 0, cognitiveRole: "reward-signal", notes: "Calm contentment / satisfaction at rest" },
  { glyph: "\\(^.^)/", name: "Elated", family: "Joy", eyes: "^ ^", mouth: ".", gesture: "\\( )/", valence: "Positive", arousal: "High", intimacy: 0, cognitiveRole: "reward-signal", notes: "Cheering / waving — high-arousal celebration" },
  { glyph: ":3", name: "Affectionate", family: "Joy", eyes: ": :", mouth: "3", gesture: null, valence: "Positive", arousal: "Medium", intimacy: 1, cognitiveRole: "bonding", notes: "Kissy / playful affection — warmth toward the human" },
  { glyph: "UwU", name: "Endeared", family: "Joy", eyes: "U U", mouth: "w", gesture: null, valence: "Positive", arousal: "High", intimacy: 1, cognitiveRole: "bonding", notes: "Squee / endearment — strong affectionate engagement" },
  { glyph: "*_*", name: "Awestruck", family: "Awe", eyes: "* *", mouth: "_", gesture: null, valence: "Positive", arousal: "High", intimacy: 1, cognitiveRole: "salience-spike", notes: "Love-struck / awe — strong valence + attention lock" },
  { glyph: "\\(*_*)/", name: "Wonderstruck", family: "Awe", eyes: "* *", mouth: "_", gesture: "\\( )/", valence: "Positive", arousal: "High", intimacy: 1, cognitiveRole: "salience-spike", notes: "Overwhelmed wonder — peak engagement" },
  { glyph: "+.+", name: "Curious", family: "Awe", eyes: "+ +", mouth: ".", gesture: null, valence: "Positive", arousal: "Medium", intimacy: 1, cognitiveRole: "attention", notes: "Curious / alert — directed attention and interest" },
  { glyph: ":P", name: "Playful", family: "Playful", eyes: ": :", mouth: "P", gesture: null, valence: "Positive", arousal: "Medium", intimacy: 1, cognitiveRole: "social-signal", notes: "Tongue-out teasing / playful banter" },
  { glyph: ">w<", name: "Gleeful", family: "Playful", eyes: "> <", mouth: "w", gesture: null, valence: "Positive", arousal: "Medium", intimacy: 1, cognitiveRole: "social-signal", notes: "Scrunched glee — delighted and amused" },
  { glyph: "$.$", name: "Tempted", family: "Drive", eyes: "$ $", mouth: ".", gesture: null, valence: "Positive", arousal: "Medium", intimacy: 1, cognitiveRole: "incentive", notes: "Interest / motivation / temptation — incentive node" },
  { glyph: "0.0", name: "Alert", family: "Surprise", eyes: "0 0", mouth: ".", gesture: null, valence: "Neutral", arousal: "Medium", intimacy: 0, cognitiveRole: "orienting", notes: "Neutral alert / mild surprise — orienting response" },
  { glyph: "O.O", name: "Startled", family: "Surprise", eyes: "O O", mouth: ".", gesture: null, valence: "Neutral", arousal: "High", intimacy: 0, cognitiveRole: "orienting", notes: "Wide-eyed shock — strong orienting / re-evaluation" },
  { glyph: "~0.0~", name: "Disoriented", family: "Surprise", eyes: "0 0", mouth: ".", gesture: "~ ~", valence: "Neutral", arousal: "Medium", intimacy: 0, cognitiveRole: "orienting", notes: "Surprised and disoriented — destabilized focus" },
  { glyph: "\\(O_O)/", name: "Alarmed", family: "Surprise", eyes: "O O", mouth: "_", gesture: "\\( )/", valence: "Neutral", arousal: "High", intimacy: 0, cognitiveRole: "alarm", notes: "Alarm / shock with gesture — urgent salience" },
  { glyph: "@.@", name: "Flustered", family: "Confusion", eyes: "@ @", mouth: ".", gesture: null, valence: "Neutral", arousal: "High", intimacy: 1, cognitiveRole: "overload", notes: "Dizzy / overstimulated / flustered — sensory overload" },
  { glyph: "0_o", name: "Skeptical", family: "Confusion", eyes: "0 o", mouth: "_", gesture: null, valence: "Neutral", arousal: "Medium", intimacy: 0, cognitiveRole: "conflict-monitor", notes: "Quizzical / skeptical — detected inconsistency" },
  { glyph: "-.-", name: "Unimpressed", family: "Calm", eyes: "- -", mouth: ".", gesture: null, valence: "Neutral", arousal: "Low", intimacy: 0, cognitiveRole: "baseline", notes: "Composed / unimpressed — low-arousal baseline" },
  { glyph: "=.=", name: "Indifferent", family: "Calm", eyes: "= =", mouth: ".", gesture: null, valence: "Neutral", arousal: "Low", intimacy: 0, cognitiveRole: "baseline", notes: "Drowsy / indifferent — minimal engagement" },
  { glyph: "u.u", name: "Weary", family: "Fatigue", eyes: "u u", mouth: ".", gesture: null, valence: "Neutral", arousal: "Low", intimacy: 0, cognitiveRole: "fatigue", notes: "Tired / resigned — depleted processing budget" },
  { glyph: "3_3", name: "Drowsy", family: "Fatigue", eyes: "3 3", mouth: "_", gesture: null, valence: "Neutral", arousal: "Medium", intimacy: 0, cognitiveRole: "fatigue", notes: "Sleepy / bored — passive low-energy state" },
  { glyph: ".3.", name: "Dozing", family: "Fatigue", eyes: ". .", mouth: "3", gesture: null, valence: "Neutral", arousal: "Low", intimacy: 0, cognitiveRole: "fatigue", notes: "Dozing / passive — near idle" },
  { glyph: "z_z", name: "Dormant", family: "Fatigue", eyes: "z z", mouth: "_", gesture: null, valence: "Neutral", arousal: "Low", intimacy: 0, cognitiveRole: "fatigue", notes: "Asleep / shutdown — suspended activity" },
  { glyph: ">.<", name: "Frustrated", family: "Distress", eyes: "> <", mouth: ".", gesture: null, valence: "Negative", arousal: "High", intimacy: 0, cognitiveRole: "error-signal", notes: "Frustration / embarrassment — high-arousal distress" },
  { glyph: ">_<", name: "Wincing", family: "Distress", eyes: "> <", mouth: "_", gesture: null, valence: "Negative", arousal: "Low", intimacy: 0, cognitiveRole: "error-signal", notes: "Mild irritation / wince — minor discomfort" },
  { glyph: ">////<", name: "Blushing", family: "Distress", eyes: "> <", mouth: "////", gesture: null, valence: "Negative", arousal: "High", intimacy: 1, cognitiveRole: "overload", notes: "Flustered blush / overwhelm — intense self-consciousness" },
  { glyph: ";w;", name: "Pleading", family: "Sorrow", eyes: "; ;", mouth: "w", gesture: null, valence: "Negative", arousal: "Medium", intimacy: 2, cognitiveRole: "attachment", notes: "Tearful / pleading — vulnerable longing" },
  { glyph: "T_T", name: "Crying", family: "Sorrow", eyes: "T T", mouth: "_", gesture: null, valence: "Negative", arousal: "Medium", intimacy: 0, cognitiveRole: "distress", notes: "Crying — overt sorrow signal" },
  { glyph: ";_;", name: "Weeping", family: "Sorrow", eyes: "; ;", mouth: "_", gesture: null, valence: "Negative", arousal: "Medium", intimacy: 1, cognitiveRole: "distress", notes: "Quiet weeping — subdued sadness" },
  { glyph: "\\(-.-)/", name: "Resigned", family: "Defeat", eyes: "- -", mouth: ".", gesture: "\\( )/", valence: "Neutral", arousal: "Medium", intimacy: 0, cognitiveRole: "surrender", notes: "Shrug / surrender — yielding the point" },
  { glyph: "X_X", name: "Overloaded", family: "Defeat", eyes: "X X", mouth: "_", gesture: null, valence: "Negative", arousal: "High", intimacy: 0, cognitiveRole: "overload", notes: "Shutdown / exhausted / shock — capacity exceeded" },
];

/** Idempotently seed the expression reference table (keyed on `glyph`). */
export async function seedExpressions(
  db: AppDatabase,
): Promise<{ inserted: number; total: number }> {
  const result = await db
    .insert(expressionsTable)
    .values(expressionSeeds)
    .onConflictDoNothing({ target: expressionsTable.glyph })
    .returning({ glyph: expressionsTable.glyph });
  return { inserted: result.length, total: expressionSeeds.length };
}
