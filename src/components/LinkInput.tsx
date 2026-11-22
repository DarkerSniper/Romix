import { useState, type KeyboardEvent } from "react";
import { Link2 } from "lucide-react";

interface LinkInputProps {
  /** Returns error messages for any lines that couldn't be added. */
  onSubmit: (lines: string[]) => string[];
}

export function LinkInput({ onSubmit }: LinkInputProps) {
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const submit = (text = value) => {
    const lines = text.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      setErrors(["Paste a YouTube Music link first"]);
      return;
    }
    setErrors(onSubmit(lines));
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div>
      <div className={`link-input ${errors.length ? "has-error" : ""}`}>
        <Link2 size={15} className="link-icon" aria-hidden="true" />
        <textarea
          rows={1}
          value={value}
          placeholder="Paste YouTube Music links"
          aria-label="YouTube links"
          spellCheck={false}
          onChange={(e) => {
            setValue(e.target.value);
            if (errors.length) setErrors([]);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            // Pasting into an empty field adds right away, like dropping a link in.
            if (!value) {
              e.preventDefault();
              submit(e.clipboardData.getData("text"));
            }
          }}
        />
        {value.trim() && (
          <button className="add-btn" onClick={() => submit()}>
            Add
          </button>
        )}
      </div>
      {errors.length > 0 && (
        <ul className="link-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
