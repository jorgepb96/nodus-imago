// Adapted from Nodus Research, AGPL-3.0-only.
/**
 * Pure helpers for AI columns: building the row context an AI cell is computed from,
 * and a small library of preconfigured prompts. Dependency-free so the context
 * assembly is unit-tested without a database or an AI provider.
 */

import { decodeCheckbox, decodeMultiSelect } from './databases';
import type { DatabaseColumn, DatabaseRow } from './databases';
type PromptLanguage = 'es'|'en'|'fr'|'de'|'pt'|'pt-BR'|'it'|'tr'|'zh-Hans'|'zh-Hant'|'vi'|'ja'|'ru'|'uk'|'ko';
import { databasePropertyPlainText } from './databaseProperties';
import type { AiPresetId } from './databases';

/** A preset the user can drop into an AI column's prompt. */
export interface AiColumnPreset {
  id: string;
  label: string;
  prompt: string;
  /** Hints the preset works over an attached image (vision). */
  needsImage?: boolean;
}

interface AiColumnPromptCopy {
  system: string;
  yes: string;
  no: string;
  rowData: string;
  emptyRow: string;
  rowContext: string;
}

const AI_COLUMN_PROMPT_COPY: Record<PromptLanguage, AiColumnPromptCopy> = {
  es: { system: 'Eres un asistente que rellena UNA celda de una base de datos a partir de los datos de su fila. Sigue exactamente la instrucción del usuario y responde SOLO con el valor de la celda: sin preámbulos, sin explicaciones, sin comillas ni formato adicional, salvo que la instrucción pida lo contrario. Básate únicamente en los datos proporcionados; si faltan datos para responder, deja la respuesta vacía.', yes: 'sí', no: 'no', rowData: 'DATOS DE LA FILA', emptyRow: 'fila vacía', rowContext: 'Contexto de la fila (úsalo para ilustrar este registro concreto)' },
  en: { system: 'You fill ONE database cell from the data in its row. Follow the user’s instruction exactly and return ONLY the cell value: no preamble, explanation, quotation marks, or extra formatting unless the instruction requests otherwise. Use only the supplied data; if there is not enough data to answer, return an empty response.', yes: 'yes', no: 'no', rowData: 'ROW DATA', emptyRow: 'empty row', rowContext: 'Row context (use it to illustrate this specific record)' },
  fr: { system: 'Vous remplissez UNE cellule de base de données à partir des données de sa ligne. Suivez exactement l’instruction de l’utilisateur et renvoyez UNIQUEMENT la valeur de la cellule : sans préambule, explication, guillemets ni mise en forme supplémentaire, sauf demande contraire. Utilisez seulement les données fournies ; si elles ne suffisent pas, renvoyez une réponse vide.', yes: 'oui', no: 'non', rowData: 'DONNÉES DE LA LIGNE', emptyRow: 'ligne vide', rowContext: 'Contexte de la ligne (utilisez-le pour illustrer cet enregistrement précis)' },
  de: { system: 'Du füllst EINE Datenbankzelle anhand der Daten ihrer Zeile aus. Befolge die Anweisung der nutzenden Person genau und gib NUR den Zellwert zurück: keine Einleitung, Erklärung, Anführungszeichen oder zusätzliche Formatierung, sofern nicht anders verlangt. Verwende ausschließlich die bereitgestellten Daten; reichen sie nicht aus, gib eine leere Antwort zurück.', yes: 'ja', no: 'nein', rowData: 'ZEILENDATEN', emptyRow: 'leere Zeile', rowContext: 'Zeilenkontext (verwende ihn zur Darstellung dieses konkreten Datensatzes)' },
  pt: { system: 'Preenches UMA célula de uma base de dados a partir dos dados da respetiva linha. Segue exatamente a instrução do utilizador e devolve APENAS o valor da célula: sem preâmbulo, explicações, aspas ou formatação adicional, salvo indicação em contrário. Usa apenas os dados fornecidos; se forem insuficientes, devolve uma resposta vazia.', yes: 'sim', no: 'não', rowData: 'DADOS DA LINHA', emptyRow: 'linha vazia', rowContext: 'Contexto da linha (usa-o para ilustrar este registo concreto)' },
  'pt-BR': { system: 'Você preenche UMA célula de banco de dados a partir dos dados da respectiva linha. Siga exatamente a instrução do usuário e retorne SOMENTE o valor da célula: sem preâmbulo, explicações, aspas ou formatação adicional, salvo indicação em contrário. Use apenas os dados fornecidos; se forem insuficientes, retorne uma resposta vazia.', yes: 'sim', no: 'não', rowData: 'DADOS DA LINHA', emptyRow: 'linha vazia', rowContext: 'Contexto da linha (use-o para ilustrar este registro específico)' },
  it: { system: 'Compili UNA cella di un database a partire dai dati della sua riga. Segui esattamente l’istruzione dell’utente e restituisci SOLO il valore della cella: senza preamboli, spiegazioni, virgolette o formattazione aggiuntiva, salvo richiesta contraria. Usa esclusivamente i dati forniti; se non bastano, restituisci una risposta vuota.', yes: 'sì', no: 'no', rowData: 'DATI DELLA RIGA', emptyRow: 'riga vuota', rowContext: 'Contesto della riga (usalo per illustrare questo specifico record)' },
  tr: { system: 'Bir veritabanı satırındaki verilerden TEK bir hücreyi doldurursun. Kullanıcının talimatını aynen uygula ve YALNIZCA hücre değerini döndür: aksi istenmedikçe giriş, açıklama, tırnak veya ek biçimlendirme kullanma. Yalnızca sağlanan verilere dayan; yanıt için veri yetersizse boş yanıt döndür.', yes: 'evet', no: 'hayır', rowData: 'SATIR VERİLERİ', emptyRow: 'boş satır', rowContext: 'Satır bağlamı (bu belirli kaydı betimlemek için kullan)' },
  'zh-Hans': { system: '你负责根据某一行的数据填充数据库中的一个单元格。请严格遵循用户的指令，只返回单元格的值：除非指令另有要求，否则不要添加前言、解释、引号或额外格式。仅依据所提供的数据作答；若数据不足以回答，则返回空响应。', yes: '是', no: '否', rowData: '行数据', emptyRow: '空行', rowContext: '行上下文（用来说明这条具体记录）' },
  'zh-Hant': { system: '你負責根據某一列的資料填充資料庫中的一個儲存格。請嚴格遵循使用者的指令，只傳回儲存格的值：除非指令另有要求，否則不要添加前言、解釋、引號或額外格式。僅依據所提供的資料作答；若資料不足以回答，則傳回空回應。', yes: '是', no: '否', rowData: '列資料', emptyRow: '空列', rowContext: '列脈絡（用於說明這筆具體紀錄）' },
  vi: { system: 'Bạn điền MỘT ô của cơ sở dữ liệu từ dữ liệu trong hàng của ô đó. Hãy tuân thủ chính xác chỉ dẫn của người dùng và chỉ trả về giá trị của ô: không mở đầu, không giải thích, không dấu ngoặc kép hay định dạng thêm, trừ khi chỉ dẫn yêu cầu khác. Chỉ dựa trên dữ liệu được cung cấp; nếu không đủ dữ liệu để trả lời, hãy trả về phản hồi trống.', yes: 'có', no: 'không', rowData: 'DỮ LIỆU HÀNG', emptyRow: 'hàng trống', rowContext: 'Ngữ cảnh của hàng (dùng để minh họa bản ghi cụ thể này)' },
  ja: { system: 'あなたは行のデータからデータベースの 1 つのセルを埋めます。ユーザーの指示に正確に従い、セルの値のみを返してください。指示に別段の要求がない限り、前書き・説明・引用符・追加の書式は付けないでください。提供されたデータのみに基づいてください。回答に十分なデータがない場合は、空の応答を返してください。', yes: 'はい', no: 'いいえ', rowData: '行データ', emptyRow: '空の行', rowContext: '行のコンテキスト（この特定のレコードを描写するために使用してください）' },
  ru: { system: 'Вы заполняете ОДНУ ячейку базы данных на основе данных её строки. Точно следуйте инструкции пользователя и возвращайте ТОЛЬКО значение ячейки: без вступления, объяснений, кавычек и дополнительного форматирования, если инструкция не требует иного. Используйте только предоставленные данные; если данных для ответа недостаточно, верните пустой ответ.', yes: 'да', no: 'нет', rowData: 'ДАННЫЕ СТРОКИ', emptyRow: 'пустая строка', rowContext: 'Контекст строки (используйте его для иллюстрации этой конкретной записи)' },
  uk: { system: 'Ви заповнюєте ОДНУ клітинку бази даних на основі даних її рядка. Точно дотримуйтеся інструкції користувача й повертайте ЛИШЕ значення клітинки: без вступу, пояснень, лапок чи додаткового форматування, якщо інструкція не вимагає іншого. Використовуйте лише надані дані; якщо даних для відповіді бракує, поверніть порожню відповідь.', yes: 'так', no: 'ні', rowData: 'ДАНІ РЯДКА', emptyRow: 'порожній рядок', rowContext: 'Контекст рядка (використовуйте його для ілюстрації цього конкретного запису)' },
  ko: { system: '당신은 행의 데이터로 데이터베이스의 셀 하나를 채웁니다. 사용자의 지시를 정확히 따르고 셀 값만 반환하십시오. 지시가 달리 요구하지 않는 한 서두, 설명, 따옴표 또는 추가 서식을 넣지 마십시오. 제공된 데이터만 사용하고, 답변에 데이터가 부족하면 빈 응답을 반환하십시오.', yes: '예', no: '아니오', rowData: '행 데이터', emptyRow: '빈 행', rowContext: '행 컨텍스트(이 특정 레코드를 설명하는 데 사용하십시오)' },
};

function aiColumnPromptCopy(language: PromptLanguage = 'es'): AiColumnPromptCopy {
  return AI_COLUMN_PROMPT_COPY[language] ?? AI_COLUMN_PROMPT_COPY.es;
}

export const AI_COLUMN_PRESETS: AiColumnPreset[] = [
  { id: 'summary', label: 'Resumen', prompt: 'Resume el contenido de esta fila en una o dos frases claras.' },
  { id: 'classify', label: 'Clasificar', prompt: 'Clasifica esta fila en una categoría breve (una o dos palabras). Devuelve solo la categoría.' },
  { id: 'keywords', label: 'Palabras clave', prompt: 'Extrae de 3 a 5 palabras clave separadas por comas. Devuelve solo las palabras clave.' },
  { id: 'sentiment', label: 'Sentimiento', prompt: 'Indica el sentimiento del contenido: positivo, negativo o neutro. Devuelve solo una palabra.' },
  { id: 'translate_en', label: 'Traducir al inglés', prompt: 'Traduce el contenido principal de esta fila al inglés. Devuelve solo la traducción.' },
  { id: 'describe_image', label: 'Describir imagen', prompt: 'Describe en 40-60 palabras la imagen adjunta a esta fila.', needsImage: true },
  { id: 'ocr', label: 'Transcribir (OCR)', prompt: 'Transcribe literalmente todo el texto que aparezca en la imagen o archivo adjunto. Devuelve solo la transcripción.', needsImage: true },
];

/** Ready-made tasks for an AI property. Labels are Spanish source strings (t()). */
export const AI_PRESETS: { id: AiPresetId; label: string; hint: string }[] = [
  { id: 'describe', label: 'Descripción breve', hint: 'Dos o tres frases con lo esencial de la imagen.' },
  { id: 'describe_detailed', label: 'Descripción detallada', hint: 'Un texto en prosa, en párrafos, con lo que se ve.' },
  { id: 'tags', label: 'Etiquetas', hint: 'Palabras clave: de tu lista o libres.' },
  { id: 'transcribe', label: 'Transcribir texto', hint: 'Copia literal del texto visible (sellos, notas, pies).' },
  { id: 'title', label: 'Título sugerido', hint: 'Un título breve y descriptivo.' },
  { id: 'custom', label: 'Personalizado', hint: 'Escribe tus propias instrucciones.' },
];

/** A ready-made task the user saved (Settings › aiUserPresets). */
export interface AiUserPreset {
  id: string;
  name: string;
  prompt: string;
  /** text: one value; tags: a list of labels. */
  output: 'text' | 'tags';
}

/** The preset a column uses: explicit, else custom when it has its own prompt. */
export function aiPresetOf(config: { aiPreset?: AiPresetId; aiPrompt?: string }): AiPresetId {
  if (config.aiPreset && AI_PRESETS.some((p) => p.id === config.aiPreset)) return config.aiPreset;
  return config.aiPrompt?.trim() ? 'custom' : 'describe';
}

type PresetCopy = {
  output: { value: string; list: string };
  describe: string;
  describe_detailed: string;
  /** max null: as many as apply. */
  tagsFree: (max: number | null) => string;
  tagsFixed: (labels: string, max: number | null) => string;
  transcribe: string;
  title: string;
  extra: string;
  criteria: string;
  definitions: string;
  answerIn: (language: string) => string;
};

const PRESET_COPY: { es: PresetCopy; en: PresetCopy; fr: PresetCopy } = {
  es: {
    output: {
      value: 'Formato de respuesta: SOLO un objeto JSON {"value": "..."} cuyo valor es el texto final de la celda. No escribas razonamientos, notas ni nada fuera del JSON.',
      list: 'Formato de respuesta: SOLO un array JSON de cadenas, por ejemplo ["retrato", "interior"]. No escribas razonamientos, notas ni nada fuera del JSON.',
    },
    describe:
      'Escribe una descripción breve de la imagen en dos o tres frases completas de prosa fluida. Empieza por el tema principal (qué o quién aparece y qué ocurre) y añade después el detalle visual más significativo: el entorno, la luz o la composición. Describe solo lo que se ve; no inventes nombres, fechas ni lugares, y cuando algo no sea seguro dilo con naturalidad ("parece", "posiblemente"). No uses listas, guiones, viñetas, títulos ni negritas.',
    describe_detailed:
      'Escribe una descripción detallada de la imagen en prosa, organizada en dos o tres párrafos bien construidos. El primero presenta el tema principal y la escena en conjunto; el segundo recorre los elementos relevantes (personas, objetos, espacio y relaciones entre ellos) siguiendo un orden visual claro, de lo principal a lo secundario; el último, si aporta algo, comenta la técnica, la composición, la luz o el estado de conservación. Describe solo lo observable; no inventes identidades, fechas ni lugares, y señala con naturalidad lo dudoso ("parece", "posiblemente"). No uses listas, guiones, viñetas, títulos ni negritas: solo párrafos separados por una línea en blanco.',
    tagsFree: (max) => `Propón ${max === null ? "todas las etiquetas pertinentes" : max === 1 ? "una sola etiqueta" : `hasta ${max} etiquetas`} que describan el contenido visible de la imagen: tema, objetos, tipo de espacio, época aparente o técnica cuando sean evidentes. Cada etiqueta tiene una o dos palabras, en minúscula salvo nombres propios, sin repeticiones ni sinónimos.`,
    tagsFixed: (labels, max) => `Elige ${max === 1 ? "la etiqueta que mejor corresponda" : "las etiquetas que correspondan claramente"} a la imagen${max === null || max === 1 ? "" : `, como máximo ${max}`}, SOLO de esta lista exacta y con la misma escritura: ${labels}. Si ninguna corresponde, devuelve [].`,
    transcribe:
      'Transcribe literalmente todo el texto visible en la imagen: inscripciones, sellos, firmas, notas manuscritas y pies impresos. Conserva la lengua, la ortografía, las abreviaturas y los saltos de línea originales; no traduzcas ni corrijas. Escribe [ilegible] en lo que no se pueda leer y separa con una línea en blanco los textos distintos. Si no hay texto, devuelve {"value": ""}.',
    title: 'Propón un título breve y descriptivo para la imagen, de cuatro a diez palabras, que nombre su tema principal. Sin comillas ni punto final, y sin inventar nombres, fechas ni lugares que no se lean en la imagen.',
    extra: 'Indicaciones adicionales del usuario',
    criteria: 'Criterios generales de clasificación (síguelos siempre)',
    definitions: 'Qué significa cada etiqueta (elige la que mejor encaje con estas definiciones)',
    answerIn: (language) => `Escribe la respuesta en ${language}.`,
  },
  en: {
    output: {
      value: 'Answer format: ONLY a JSON object {"value": "..."} whose value is the final text of the cell. Do not write reasoning, notes or anything outside the JSON.',
      list: 'Answer format: ONLY a JSON array of strings, for example ["portrait", "interior"]. Do not write reasoning, notes or anything outside the JSON.',
    },
    describe:
      'Write a short description of the image in two or three complete sentences of flowing prose. Start with the main subject (what or who appears and what is happening), then add the most significant visual detail: the setting, the light or the composition. Describe only what is visible; do not invent names, dates or places, and state uncertainty naturally ("appears to", "possibly"). Do not use lists, dashes, bullet points, headings or bold text.',
    describe_detailed:
      'Write a detailed description of the image in prose, organised in two or three well-built paragraphs. The first introduces the main subject and the scene as a whole; the second goes through the relevant elements (people, objects, space and how they relate) in a clear visual order, from main to secondary; the last, if it adds something, comments on technique, composition, light or condition. Describe only what is observable; do not invent identities, dates or places, and state uncertainty naturally ("appears to", "possibly"). Do not use lists, dashes, bullet points, headings or bold text: only paragraphs separated by a blank line.',
    tagsFree: (max) => `Suggest ${max === null ? "every relevant tag" : max === 1 ? "a single tag" : `up to ${max} tags`} describing the visible content of the image: subject, objects, type of space, apparent period or technique when evident. Each tag has one or two words, lower case except proper names, with no repetitions or synonyms.`,
    tagsFixed: (labels, max) => `Choose ${max === 1 ? "the tag that best applies" : "the tags that clearly apply"} to the image${max === null || max === 1 ? "" : `, at most ${max}`}, ONLY from this exact list and with the same spelling: ${labels}. If none applies, return [].`,
    transcribe:
      'Transcribe literally all the text visible in the image: inscriptions, stamps, signatures, handwritten notes and printed captions. Keep the original language, spelling, abbreviations and line breaks; do not translate or correct. Write [illegible] for unreadable parts and separate different texts with a blank line. If there is no text, return {"value": ""}.',
    title: 'Suggest a short descriptive title for the image, four to ten words long, naming its main subject. No quotation marks or final full stop, and do not invent names, dates or places that cannot be read in the image.',
    extra: 'Additional instructions from the user',
    criteria: 'General classification criteria (always follow them)',
    definitions: 'What each tag means (choose the one that best fits these definitions)',
    answerIn: (language) => `Write the answer in ${language}.`,
  },
  fr: {
    output: {
      value: 'Format de réponse : UNIQUEMENT un objet JSON {"value": "..."} dont la valeur est le texte final de la cellule. N\'écrivez ni raisonnement, ni notes, ni rien en dehors du JSON.',
      list: 'Format de réponse : UNIQUEMENT un tableau JSON de chaînes, par exemple ["portrait", "intérieur"]. N\'écrivez ni raisonnement, ni notes, ni rien en dehors du JSON.',
    },
    describe:
      'Rédigez une brève description de l\'image en deux ou trois phrases complètes, en prose fluide. Commencez par le sujet principal (qui ou quoi apparaît et ce qui se passe), puis ajoutez le détail visuel le plus significatif : le cadre, la lumière ou la composition. Ne décrivez que ce qui se voit ; n\'inventez ni noms, ni dates, ni lieux, et lorsque quelque chose est incertain, dites-le naturellement ("semble", "peut-être"). N\'utilisez ni listes, ni tirets, ni puces, ni titres, ni gras.',
    describe_detailed:
      'Rédigez une description détaillée de l\'image en prose, organisée en deux ou trois paragraphes bien construits. Le premier présente le sujet principal et la scène dans son ensemble ; le deuxième passe en revue les éléments pertinents (personnes, objets, espace et relations entre eux) selon un ordre visuel clair, du principal au secondaire ; le dernier, s\'il apporte quelque chose, commente la technique, la composition, la lumière ou l\'état de conservation. Ne décrivez que ce qui est observable ; n\'inventez ni identités, ni dates, ni lieux, et signalez naturellement ce qui est douteux ("semble", "peut-être"). N\'utilisez ni listes, ni tirets, ni puces, ni titres, ni gras : uniquement des paragraphes séparés par une ligne vide.',
    tagsFree: (max) => `Proposez ${max === null ? "toutes les étiquettes pertinentes" : max === 1 ? "une seule étiquette" : `jusqu'à ${max} étiquettes`} décrivant le contenu visible de l'image : sujet, objets, type d'espace, époque apparente ou technique lorsqu'ils sont évidents. Chaque étiquette comporte un ou deux mots, en minuscules sauf pour les noms propres, sans répétitions ni synonymes.`,
    tagsFixed: (labels, max) => `Choisissez ${max === 1 ? "l'étiquette qui correspond le mieux" : "les étiquettes qui correspondent clairement"} à l'image${max === null || max === 1 ? "" : `, au maximum ${max}`}, UNIQUEMENT dans cette liste exacte et avec la même graphie : ${labels}. Si aucune ne correspond, renvoyez [].`,
    transcribe:
      'Transcrivez littéralement tout le texte visible dans l\'image : inscriptions, cachets, signatures, notes manuscrites et légendes imprimées. Conservez la langue, l\'orthographe, les abréviations et les retours à la ligne d\'origine ; ne traduisez ni ne corrigez. Écrivez [illisible] pour ce qui ne se lit pas et séparez les textes distincts par une ligne vide. S\'il n\'y a pas de texte, renvoyez {"value": ""}.',
    title: 'Proposez un titre bref et descriptif pour l\'image, de quatre à dix mots, qui nomme son sujet principal. Sans guillemets ni point final, et sans inventer de noms, de dates ni de lieux qui ne se lisent pas dans l\'image.',
    extra: 'Indications supplémentaires de l\'utilisateur',
    criteria: 'Critères généraux de classification (suivez-les toujours)',
    definitions: 'Ce que signifie chaque étiquette (choisissez celle qui correspond le mieux à ces définitions)',
    answerIn: (language) => `Rédigez la réponse en ${language}.`,
  },
};

function presetCopy(language: string): PresetCopy {
  return language === 'es' ? PRESET_COPY.es : language === 'fr' ? PRESET_COPY.fr : PRESET_COPY.en;
}

/** The task text of a built-in preset, as the user reads it in Properties. */
export function aiPresetTask(
  preset: AiPresetId,
  language: string,
  tags: string[] = [],
  /** Most tags the AI may use; null for no limit. */
  maxTags: number | null = 5,
): string {
  const copy = presetCopy(language);
  switch (preset) {
    case 'tags':
      return tags.length
        ? copy.tagsFixed(JSON.stringify(tags), maxTags === null ? null : Math.min(maxTags, tags.length))
        : copy.tagsFree(maxTags);
    case 'custom':
      return '';
    default:
      return copy[preset];
  }
}

/**
 * The instruction and expected output shape for an AI property, written in the
 * interface language (Spanish, English or French; other languages use the English
 * wording and ask for the answer in their own language).
 */
export function aiPresetInstruction(
  config: {
    aiPreset?: AiPresetId;
    aiPrompt?: string;
    aiTags?: string[];
    aiOutput?: 'text' | 'tags';
    /** Classification: general criteria and a definition per tag. */
    aiCriteria?: string;
    aiTagDefinitions?: { label: string; definition: string }[];
  },
  language: string,
  languageName: string,
  /** How many tags at most (1 for a single choice, null for no limit). */
  maxTags: number | null = 5,
): { instruction: string; output: 'value' | 'list'; tags: string[] | null } {
  const copy = presetCopy(language),
    preset = aiPresetOf(config),
    extra = config.aiPrompt?.trim() ?? '',
    tags = (config.aiTags ?? []).map((t) => t.trim()).filter(Boolean);
  const output: 'value' | 'list' =
    preset === 'tags' || (preset === 'custom' && config.aiOutput === 'tags') ? 'list' : 'value';
  const task = preset === 'custom' ? extra || copy.describe : aiPresetTask(preset, language, tags, maxTags);
  const parts = [task];
  const criteria = config.aiCriteria?.trim();
  if (criteria) parts.push(`${copy.criteria}:\n${criteria}`);
  const definitions = (config.aiTagDefinitions ?? []).filter((d) => d.definition.trim());
  if (definitions.length)
    parts.push(
      `${copy.definitions}:\n` +
        definitions.map((d) => `- ${d.label}: ${d.definition.trim().replace(/\s+/g, ' ')}`).join('\n'),
    );
  if (extra && preset !== 'custom') parts.push(`${copy.extra}: ${extra}`);
  if (preset !== 'transcribe' && !(preset === 'tags' && tags.length)) parts.push(copy.answerIn(languageName));
  parts.push(copy.output[output]);
  return { instruction: parts.join('\n\n'), output, tags: preset === 'tags' && tags.length ? tags : null };
}

/**
 * A plain-text block describing a row, fed to the AI cell's prompt as context. Skips
 * the AI column being computed (and other AI columns, to avoid feeding derived values
 * back in). Resolves select/multi-select option labels and folds in the extracted text
 * of any attachments so a summary/OCR prompt has something to work with.
 */
export function buildAiRowContext(
  columns: DatabaseColumn[],
  row: DatabaseRow,
  opts: { excludeColumnId?: string; language?: PromptLanguage } = {}
): string {
  const copy = aiColumnPromptCopy(opts.language);
  const lines: string[] = [];
  for (const col of columns) {
    if (col.id === opts.excludeColumnId || col.type === 'ai') continue;
    const raw = row.cells[col.id] ?? null;
    let value = '';
    switch (col.type) {
      case 'select':
      case 'status':
        value = col.options.find((o) => o.id === raw)?.label ?? '';
        break;
      case 'multi_select':
        value = decodeMultiSelect(raw)
          .map((id) => col.options.find((o) => o.id === id)?.label ?? '')
          .filter(Boolean)
          .join(', ');
        break;
      case 'checkbox':
        value = decodeCheckbox(raw) ? copy.yes : copy.no;
        break;
      case 'attachment':
      case 'files': {
        const atts = row.attachments?.[col.id] ?? [];
        const names = atts.map((a) => a.fileName ?? '').filter(Boolean).join(', ');
        const texts = atts.map((a) => a.extractedText).filter((x): x is string => Boolean(x && x.trim()));
        value = [names, ...texts].filter(Boolean).join('\n');
        break;
      }
      default:
        value = databasePropertyPlainText(col.type, raw);
    }
    if (value && value.trim()) lines.push(`${col.name}: ${value.trim()}`);
  }
  return lines.join('\n');
}

export const AI_COLUMN_SYSTEM = `Eres un asistente que rellena UNA celda de una base de datos a partir de los datos de su fila. Sigue exactamente la instrucción del usuario y responde SOLO con el valor de la celda: sin preámbulos, sin explicaciones, sin comillas ni formato adicional, salvo que la instrucción pida lo contrario. Básate únicamente en los datos proporcionados; si faltan datos para responder, deja la respuesta vacía.`;

export function aiColumnSystem(language: PromptLanguage = 'es'): string {
  return aiColumnPromptCopy(language).system;
}

/** Compose the user message for an AI cell: the user's instruction + the row context. */
export function buildAiCellPrompt(prompt: string, context: string, language: PromptLanguage = 'es'): string {
  const copy = aiColumnPromptCopy(language);
  return `${prompt.trim()}\n\n=== ${copy.rowData} ===\n${context || `(${copy.emptyRow})`}`;
}

/**
 * Compose the final text-to-image prompt for an 'ai_image' column: the user's image
 * instruction, enriched with the row's own data so the picture reflects that record.
 * Kept pure so the generation logic is unit-tested without a provider.
 */
export function buildAiImagePrompt(prompt: string, context: string, language: PromptLanguage = 'es'): string {
  const base = prompt.trim();
  if (!context.trim()) return base;
  return `${base}\n\n${aiColumnPromptCopy(language).rowContext}: ${context.replace(/\s+/g, ' ').trim().slice(0, 900)}`;
}
