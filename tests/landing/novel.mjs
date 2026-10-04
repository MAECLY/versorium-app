// The sample novel the landing-page screenshots are taken with.
//
// Written for this purpose, in both languages: nothing here is quoted from a
// published book. The Spanish is the original and the English is its own
// version of the same pages, so the two sites show the same novel.
//
// Chapter titles carry no accented letters on purpose. The real app builds
// file names with an ASCII-only slug (src-tauri/src/commands/project.rs,
// `slugify`), and the file tree printed on the landing page has to match what
// the app would actually write to disk.
//
// The novel's title is short on purpose too. The binder is a fixed 240px
// (src/lib/binder/ChapterList.svelte) and the project card gives the title
// what the word count leaves, about 85px: a longer title wrapped to three lines
// in the hero shot. The title also names the novel's folder and its first
// chapter's file (ch-01-<slug>.md, kept when that chapter is renamed), which
// the folder tree on the page prints at 12px on a 320px screen.

export const novels = {
  es: {
    title: "Lo que no figura",
    language: "es",
    hero: "ch-02",
    chapters: [
      {
        title: "El inventario",
        status: "final",
        body: `El ayuntamiento le dio tres semanas, una llave de hierro y una lista con ciento doce objetos. Irene firmó el recibo en el muelle, con el barco ya soltando amarras, y solo entonces leyó el último renglón: *Todo lo que no figure en esta lista, consígnese aparte.*

La isla no tenía más que un camino, y el camino no llevaba más que al faro. Lo subió con la maleta golpeándole la pierna y el viento empeñado en devolverla al agua.

La puerta cedió a la segunda vuelta de llave. Dentro olía a petróleo viejo y a sal, y sobre la mesa de la entrada alguien había dejado un vaso boca abajo, como se deja cuando uno piensa volver.
`,
      },
      {
        title: "La aguja",
        status: "revised",
        body: `Contó los escalones al subir y otra vez al bajar, porque la primera cuenta le dio cuarenta y tres y no se fiaba de sí misma después del barco. Eran cuarenta y dos. El que sobraba era el umbral de la sala de la lámpara, más alto que los demás, gastado en el centro por cien años de botas.

Arriba, la lente ocupaba todo el aire. No esperaba que fuera tan grande ni tan limpia: alguien había seguido puliéndola después de que la apagaran, y ese alguien no aparecía en ningún papel del ayuntamiento.

Anotó en el cuaderno: *Lente de Fresnel, primer orden, intacta.* Luego tachó *intacta*. No sabía qué palabra correspondía a una cosa que nadie usaba y todo el mundo cuidaba.

Junto a la ventana del oeste había una mesa pequeña, y sobre la mesa, una aguja imantada flotando en un cuenco de agua, sobre un trozo de corcho. Señalaba al norte con la terquedad de las cosas que no tienen otra cosa que hacer. Irene giró el cuenco despacio y la aguja volvió a su sitio, como un perro al que se llama por su nombre.

—No estás en la lista —le dijo.

El faro no contestó, pero el viento cambió de lado, y por primera vez desde que había llegado dejó de oír el mar.

Bajó a la cocina, encendió el hornillo y puso agua a calentar. Mientras esperaba, abrió el libro de registro por la última página escrita. La letra era menuda y recta, de alguien que había aprendido a escribir con frío: *14 de marzo. Niebla desde las seis. La aguja sigue apuntando donde debe. Yo también.*
`,
      },
      {
        title: "Suficiente",
        status: "revised",
        body: `La última noche que el faro estuvo encendido, según el registro, no pasó ningún barco. Irene leyó la entrada dos veces buscando una queja, una despedida, algo. Solo había la hora, el viento y una palabra subrayada: *suficiente*.

En el pueblo nadie recordaba quién había apagado la luz. Recordaban, eso sí, que esa misma semana dejó de llegar el correo los jueves.
`,
      },
      {
        title: "Las cartas",
        status: "draft",
        body: `Las cartas estaban en una caja de galletas, atadas con sedal de pesca, y ninguna llevaba sello. Iban dirigidas a la misma persona, a la misma dirección de tierra firme, y estaban fechadas a lo largo de once años.

Irene no las abrió. Las contó, las anotó como *un lote de correspondencia privada* y dejó la caja donde estaba, con la tapa un poco más cerrada que antes.
`,
      },
      {
        title: "Niebla",
        status: "draft",
        body: `La niebla llegó un martes y no se fue. Desde la galería no se veía el agua, ni el muelle, ni la línea de la costa; solo un blanco espeso que se movía despacio, como si alguien estuviera respirando al otro lado.

Fue la primera noche que Irene subió a la sala de la lámpara sin ningún motivo.
`,
      },
      {
        title: "El remo",
        status: "draft",
        body: `Lo encontró el sábado, en la cala del este: un remo pintado de azul, con un nombre grabado a navaja en la pala. El nombre no era de nadie del pueblo. Tampoco era de nadie de la lista.
`,
      },
      {
        title: "La visita",
        status: "draft",
        body: `El barco del correo volvió un jueves, contra toda costumbre, y de él bajó una mujer con un abrigo demasiado fino para la isla. Preguntó por el farero. Irene le dijo que ya no había farero, y la mujer contestó que eso ya lo sabía.
`,
      },
      {
        title: "Marea baja",
        status: "draft",
        body: `Con la marea baja aparecía un camino de piedras entre el faro y el islote. Nadie le había hablado de él. Lo descubrió por las huellas de botas, recientes, que subían desde el agua hasta la puerta de atrás.
`,
      },
    ],
    // A second novel on the same desk, so the binder reads as a writer's shelf.
    shelf: {
      title: "Cuentos de invierno",
      body: `Cada invierno el pueblo elegía a alguien para contar el primer cuento. Aquel año eligieron a la panadera, que no había contado nada en su vida y empezó por el final.
`,
    },
    // The passage selected for the Rewrite dialog (two paragraphs of the hero
    // chapter) and what the model hands back: only the second one changes.
    rewrite: {
      from: "Arriba, la lente ocupaba todo el aire.",
      to: "todo el mundo cuidaba.",
      result: `Arriba, la lente ocupaba todo el aire. No esperaba que fuera tan grande ni tan limpia: alguien había seguido puliéndola después de que la apagaran, y ese alguien no aparecía en ningún papel del ayuntamiento.

Anotó en el cuaderno: *Lente de Fresnel, primer orden, intacta.* Después tachó *intacta*: no encontraba la palabra para algo que nadie usaba y que todos, sin embargo, seguían cuidando.`,
    },
    // The sentence the hero window types at the end of the hero chapter's
    // second paragraph (docs/index.html), with its leading space: the
    // paragraph's text plus this is what the app would hold afterwards.
    typed: " Nadie le había dicho que el faro aún tuviera dueño.",
    // A described snapshot, the kind a writer types in the History panel.
    describedSnapshot: "La aguja, segunda versión",
    // A chapter deleted early on; only its snapshot message survives.
    deletedFile: "manuscript/ch-09-notas-sueltas.md",
  },

  en: {
    title: "Not on the List",
    language: "en",
    hero: "ch-02",
    chapters: [
      {
        title: "The Inventory",
        status: "final",
        body: `The council gave her three weeks, an iron key and a list of one hundred and twelve objects. Irene signed the receipt on the quay, with the boat already casting off, and only then read the last line: *Anything not on this list, record separately.*

The island had one road, and the road led only to the lighthouse. She climbed it with the suitcase knocking against her leg and the wind set on returning her to the water.

The door gave on the second turn of the key. Inside it smelled of old paraffin and salt, and on the table by the entrance someone had left a glass upside down, the way you leave one when you mean to come back.
`,
      },
      {
        title: "The Needle",
        status: "revised",
        body: `She counted the steps on the way up and again on the way down, because the first count came to forty-three and she did not trust herself after the boat. There were forty-two. The extra one was the threshold of the lamp room, higher than the rest, worn in the middle by a hundred years of boots.

Up there, the lens took up all the air. She had not expected it to be so large, or so clean: someone had gone on polishing it after the light was put out, and that someone did not appear in any of the council’s papers.

She wrote in her notebook: *Fresnel lens, first order, intact.* Then she crossed out *intact*. She did not know the word for a thing nobody used and everybody looked after.

By the west window stood a small table, and on the table a magnetised needle floated on a cork in a bowl of water. It pointed north with the stubbornness of things that have nothing else to do. Irene turned the bowl slowly and the needle swung back to its place, like a dog called by its name.

“You’re not on the list,” she told it.

The lighthouse did not answer, but the wind changed sides, and for the first time since she had arrived she stopped hearing the sea.

She went down to the kitchen, lit the stove and put water on to boil. While she waited she opened the logbook at the last page written. The hand was small and upright, the hand of someone who had learned to write in the cold: *14 March. Fog since six. The needle still points where it should. So do I.*
`,
      },
      {
        title: "Enough",
        status: "revised",
        body: `The last night the light was lit, according to the log, no ship went by. Irene read the entry twice, looking for a complaint, a farewell, anything. There was only the time, the wind and one underlined word: *enough*.

In the village nobody remembered who had put the light out. They did remember that, the same week, the post stopped coming on Thursdays.
`,
      },
      {
        title: "The Letters",
        status: "draft",
        body: `The letters were in a biscuit tin, tied with fishing line, and none of them had a stamp. They were all addressed to the same person at the same address on the mainland, and dated across eleven years.

Irene did not open them. She counted them, recorded them as *one lot of private correspondence*, and left the tin where it was, with the lid a little more closed than before.
`,
      },
      {
        title: "Fog",
        status: "draft",
        body: `The fog came on a Tuesday and did not leave. From the gallery you could not see the water, or the quay, or the line of the coast; only a thick white that moved slowly, as if someone were breathing on the other side.

It was the first night Irene climbed to the lamp room for no reason at all.
`,
      },
      {
        title: "The Oar",
        status: "draft",
        body: `She found it on Saturday, in the east cove: an oar painted blue, with a name cut into the blade with a knife. The name belonged to nobody in the village. It was not on the list either.
`,
      },
      {
        title: "The Visitor",
        status: "draft",
        body: `The mail boat came back on a Thursday, against all custom, and a woman stepped off it in a coat too thin for the island. She asked for the keeper. Irene told her there was no keeper any more, and the woman said she knew that already.
`,
      },
      {
        title: "Low Tide",
        status: "draft",
        body: `At low tide a path of stones appeared between the lighthouse and the islet. Nobody had told her about it. She found it by the bootprints, fresh, climbing from the water to the back door.
`,
      },
    ],
    shelf: {
      title: "Winter Stories",
      body: `Every winter the village chose someone to tell the first story. That year they chose the baker, who had never told anything in her life and began at the end.
`,
    },
    rewrite: {
      from: "Up there, the lens took up all the air.",
      to: "everybody looked after.",
      result: `Up there, the lens took up all the air. She had not expected it to be so large, or so clean: someone had gone on polishing it after the light was put out, and that someone did not appear in any of the council’s papers.

She wrote in her notebook: *Fresnel lens, first order, intact.* Then she crossed out *intact*: she could not find the word for something nobody used and everyone, even so, kept looking after.`,
    },
    typed: " Nobody had told her the lighthouse still had an owner.",
    describedSnapshot: "The needle, second pass",
    deletedFile: "manuscript/ch-09-loose-notes.md",
  },
};

/** The typed sentence of each language (novels[lang].typed), for importers that want only it. */
export const typed = { es: novels.es.typed, en: novels.en.typed };

/**
 * The snapshot history shown in the History panel, oldest first.
 *
 * Every message is one the app really writes: `m0: project created` and the
 * `checkpoint: …` lines come from Rust (src-tauri/src/git/repo.rs,
 * commands/git.rs, commands/ai.rs, commands/chapters.rs); a described snapshot
 * is whatever the writer typed. Times are wall-clock in the page's time zone,
 * `day` counted back from today: a week of evenings, autosaving as it goes.
 */
export function history(lang) {
  const n = novels[lang];
  return [
    { message: "m0: project created", day: 7, at: "20:02" },
    { message: "checkpoint: autosave", day: 7, at: "20:41" },
    { message: "checkpoint: autosave", day: 4, at: "21:10" },
    { message: "checkpoint: autosave", day: 1, at: "22:47" },
    { message: `checkpoint: before deleting ${n.deletedFile}`, day: 1, at: "23:18" },
    { message: "checkpoint: autosave", day: 0, at: "17:55" },
    { message: "checkpoint: before ai rewrite (qwen3-4b-instruct-2507-q4km)", day: 0, at: "18:31" },
    { message: n.describedSnapshot, day: 0, at: "18:40" },
    { message: "checkpoint: autosave", day: 0, at: "18:52" },
  ];
}
