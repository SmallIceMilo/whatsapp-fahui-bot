const fetch = require("node-fetch");
const config = require("../config");
const { stripCodeFences } = require("../utils/helpers");

async function callOpenAIForExtraction(messageText, context = {}) {
  const prompt = `
You extract registration actions from WhatsApp messages for event sign-ups.

Return STRICT JSON only.
No markdown.
No explanation.
No text outside JSON.

Schema:
{
  "actions": [
    {
      "type": "registration" | "cancellation" | "update" | "other",
      "event": "April",
      "people": [
        {
          "name": "蔡美群 chai mee kwan",
          "phone": "82296768",
          "gender": "Female",
          "sat": true,
          "sun": true
        }
      ]
    }
  ]
}

Recent sender context:
${JSON.stringify(context, null, 2)}

Rules:

Support Chinese and English.
Preserve names exactly as written. Do not translate names.
Resolve references using recent sender context, including phrases like "以上三位", "上述三位", "这三位", "same people", and "the above people".
If a message lists multiple people, extract all of them.
Numbered entries like "2) name / phone" are separate people.
If a message says "全部女性", apply Female to all listed people.
Supported events include:
19 July Sunday event
8 August Saturday event
9 August Sunday event
If the message mentions July, 19 July, 19/7, 7/19, Sunday, 星期日, 礼拜天, or 周日 in the context of the July event, extract the event as "19 July Sunday".
If the message mentions August, 8 August, 8/8, 8 Aug, Saturday, 星期六, 礼拜六, or 周六 in the context of the August event, extract the event as "8 August Saturday".
If the message mentions August, 9 August, 9/8, 9 Aug, Sunday, 星期日, 礼拜天, or 周日 in the context of the August event, extract the event as "9 August Sunday".
If the message mentions both 8 and 9 August, 8/9 August, 8-9 August, 8 & 9 August, or both Saturday and Sunday for the August event, extract the event as "8 and 9 August".
If the month/date is not stated, leave event empty.
If a Chinese name and an English name appear together for the same applicant, treat them as one person and combine into one name field, Chinese first then English.
Do not invent names or phone numbers.
If one phone number clearly belongs to the whole listed group, you may apply that same phone to all of them.
If the message refers to 19 July or the July Sunday event only: sat=false, sun=true.
If the message refers to 8 August or the August Saturday event only: sat=true, sun=false.
If the message refers to 9 August or the August Sunday event only: sat=false, sun=true.
If the message clearly says both 8 and 9 August, both days, Saturday and Sunday, 两天, 两日, or 周六周日: sat=true, sun=true.
If the message only mentions sign-up with no date, month, or day restriction, leave event empty and set sat=true, sun=true.
Memorial tablet names such as 牌位, 往生莲位, 婴灵牌位, 历代祖先莲位, 消灾, 冤亲债主 are NOT registrants.
If the message is not a real registration/cancellation/update, return type "other".
If a specific calendar date is mentioned, refer to the calendar and infer the correct weekday.
If the mentioned date is a Saturday session, set sat=true and sun=false.
If the mentioned date is a Sunday session, set sat=false and sun=true.
Do not set both days true when a single specific date is given.

Message:
${messageText}
`.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a precise JSON information extractor for event registration messages.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const cleaned = stripCodeFences(content);

  return JSON.parse(cleaned);
}

module.exports = {
  callOpenAIForExtraction,
};
