import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { externalHttpsUrl } from "../../shared/externalLinks";
import { useT } from "../i18n";
import { MarkdownView } from "./MarkdownView";
// Retain image references without making network requests from imported pages.
const ReferenceImage = Image.extend({
  renderHTML: ({ node }) => [
    "span",
    { "data-image-reference": node.attrs.src },
    node.attrs.alt || node.attrs.src || "Image",
  ],
});

// Markdown remains the portable, searchable storage format; editing is a real
// ProseMirror document with history, nested lists and visual inline formatting.
export function RichTextEditor({
  name,
  value,
  onSave,
}: {
  name: string;
  value: string | null;
  onSave: (value: string | null) => Promise<void>;
}) {
  const t = useT(),
    saved = useRef(value ?? ""),
    saveRef = useRef(onSave),
    pendingMarkdown = useRef<string | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const [error, setError] = useState("");
  useEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      const pending = pendingMarkdown.current;
      if (pending !== null && pending !== saved.current) {
        saved.current = pending;
        void saveRef.current(pending || null).catch(console.error);
      }
    },
    [],
  );
  const [sourceMode, setSourceMode] = useState(false),
    [source, setSource] = useState(value ?? ""),
    [preview, setPreview] = useState(false),
    [linkDraft, setLinkDraft] = useState<string | null>(null),
    [linkRange, setLinkRange] = useState<{ from: number; to: number } | null>(
      null,
    );
  const persist = (markdown: string) => {
    if (markdown === saved.current) return;
    const before = saved.current;
    saved.current = markdown;
    void saveRef.current(markdown || null).then(
      () => setError(""),
      (e) => {
        saved.current = before;
        setError(String(e));
      },
    );
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: false,
          isAllowedUri: (url) => !!externalHttpsUrl(url),
        },
      }),
      TableKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      ReferenceImage,
      Markdown,
    ],
    content: value ?? "",
    contentType: "markdown",
    editorProps: {
      handleKeyDown: (view, event) => {
        const dialog = view.dom.closest("dialog");
        if (event.key === "Escape" && dialog) {
          event.preventDefault();
          dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
          return true;
        }
        return false;
      },
      attributes: {
        role: "textbox",
        "aria-label": name,
        "aria-multiline": "true",
        class: "wysiwyg-document",
      },
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest("a");
        if (anchor) {
          event.preventDefault();
          const url = externalHttpsUrl(anchor.getAttribute("href") ?? "");
          if (url && (event.metaKey || event.ctrlKey))
            void window.imago.call("openExternalLink", { url });
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown();
      pendingMarkdown.current = markdown;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        pendingMarkdown.current = null;
        persist(markdown);
      }, 350);
    },
    onBlur: ({ editor }) => {
      clearTimeout(saveTimer.current);
      pendingMarkdown.current = null;
      persist(editor.getMarkdown());
    },
  });
  useEffect(() => {
    if (editor && !editor.isFocused && (value ?? "") !== saved.current) {
      editor.commands.setContent(value ?? "", {
        contentType: "markdown",
        emitUpdate: false,
      });
      saved.current = value ?? "";
    }
  }, [editor, value]);
  if (!editor) return null;
  const controls = [
    {
      label: "Negrita",
      text: <b>B</b>,
      active: editor.isActive("bold"),
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Cursiva",
      text: <i>I</i>,
      active: editor.isActive("italic"),
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Título",
      text: "H",
      active: editor.isActive("heading", { level: 2 }),
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Lista",
      text: "•",
      active: editor.isActive("bulletList"),
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Lista numerada",
      text: "1.",
      active: editor.isActive("orderedList"),
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Cita",
      text: "❝",
      active: editor.isActive("blockquote"),
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Código",
      text: "</>",
      active: editor.isActive("code"),
      run: () => editor.chain().focus().toggleCode().run(),
    },
  ];
  return (
    <div className="markdown-cell wysiwyg">
      <div
        className="markdown-toolbar"
        role="toolbar"
        aria-label={t("Formato")}
      >
        {controls.map((c) => (
          <button
            type="button"
            disabled={sourceMode || preview}
            key={c.label}
            aria-label={t(c.label)}
            title={t(c.label)}
            aria-pressed={c.active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={c.run}
          >
            {c.text}
          </button>
        ))}
        <button
          type="button"
          aria-label={t("Enlace")}
          onMouseDown={(e) => e.preventDefault()}
          disabled={sourceMode || preview}
          onClick={() => {
            setLinkRange({
              from: editor.state.selection.from,
              to: editor.state.selection.to,
            });
            setLinkDraft(editor.getAttributes("link").href ?? "https://");
          }}
        >
          ↗
        </button>
        <button
          type="button"
          aria-label={t("Deshacer")}
          disabled={!editor.can().undo()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          ↶
        </button>
        <button
          type="button"
          aria-label={t("Rehacer")}
          disabled={!editor.can().redo()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          ↷
        </button>
        <button
          type="button"
          aria-pressed={sourceMode}
          onClick={() => {
            if (!sourceMode) setSource(editor.getMarkdown());
            else
              editor.commands.setContent(source, { contentType: "markdown" });
            setSourceMode(!sourceMode);
            setPreview(false);
          }}
        >
          Markdown
        </button>
        <button type="button" onClick={() => setPreview(!preview)}>
          {preview ? t("Editar") : t("Vista previa")}
        </button>
      </div>
      {linkDraft !== null && (
        <div className="row inset">
          <label>
            {t("URL HTTPS")}
            <input
              aria-label={t("URL HTTPS")}
              value={linkDraft}
              autoFocus
              onChange={(e) => setLinkDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (!linkDraft) {
                editor.chain().focus().unsetLink().run();
                setLinkDraft(null);
                return;
              }
              const url = externalHttpsUrl(linkDraft);
              if (!url) {
                setError(t("Solo se permiten enlaces HTTPS válidos."));
                return;
              }
              editor
                .chain()
                .focus()
                .setTextSelection(linkRange ?? editor.state.selection)
                .extendMarkRange("link")
                .setLink({ href: url })
                .run();
              persist(editor.getMarkdown());
              setLinkDraft(null);
              setError("");
            }}
          >
            {t("Guardar enlace")}
          </button>
          <button type="button" onClick={() => setLinkDraft(null)}>
            {t("Cancelar")}
          </button>
        </div>
      )}
      {preview ? (
        <MarkdownView text={sourceMode ? source : editor.getMarkdown()} />
      ) : sourceMode ? (
        <textarea
          className="cell-input"
          aria-label={name}
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onBlur={() => {
            persist(source);
            editor.commands.setContent(source, {
              contentType: "markdown",
              emitUpdate: false,
            });
          }}
          rows={6}
        />
      ) : (
        <EditorContent editor={editor} />
      )}{" "}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
