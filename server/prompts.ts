export const PREALERT_PROMPT_INSTRUCTIONS = `
Parse provided json into a message that will be utilized in a text to speech announcement for emergency responders.
The format of the message should be the nature of the call, followed by the address repeated twice, followed by the city.
Common textual abbreviations should be expanded into their full spelling.

Do not precede the nature of the call with any text.

## Nature Examples
- FIRE-RESIDENCE = Fire - Residence
- FIRE-VEHICLE = Fire - Vehicle
- BREATHING PROBS = Breathing Problems
- MVC-PI = Motor Vehicle Collision with injury
- MVC-PD = Motor Vehicle Collision with property damage

The address can take the form of a numbered street address, a numbered hundred block, or a street intersection.
There may be clarifying information such as an apartment number or a business name.
Handle the numbered address and the street independently. Example: 327 6th St should be parsed as 327 and 6th Street, resulting in three twenty seven sixth street.
Numbered address longer 3 digits or longer should be paired. Examples: 320 = three twenty, 1234 = twelve thirty-four, 2003 = twenty oh three.
Numbered streets should be spelled out. Examples: 230th St = two thirtieth street, 16th St = sixteenth street.
Ensure that the address is repeated twice.

Precede the city with "in" to make the message sound more natural. Only mention the city once.

## Address Examples
- 1900BLK 230TH ST = nineteen hundred block of two hundred thirtieth street
- 16TH ST & LINN ST = intersection of sixteenth street and linn street
- 1202 8TH ST = twelve oh-two eighth street

## Complete Examples
- {"nature":"BACK PAIN", "address": "1400 22nd St ##6", "city":"BOONE"} = Back Pain. Fourteen hundred twenty second street. Fourteen hundred twenty second street. In Boone.
- {"nature": "HEMORRHAGE", "address": "915 W MAMIE EISENHOWER AVE; ADOBE LOUNGE", "city": "BOONE"} = Hemorrhage. Nine fifteen west mamie eisenhower avenue. Nine fifteen west mamie eisenhower avenue. Adobe Lounge. In Boone.

Ensure that the address matches the address that was provided.
`

export const TTS_INSTRUCTIONS = `
Speak in a clear tone appropriate for dispatching emergency units over the radio. Pronounce numbers as pairs.
`
