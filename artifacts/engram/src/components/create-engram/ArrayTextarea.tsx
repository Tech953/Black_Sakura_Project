import { useState, useEffect, TextareaHTMLAttributes } from "react";
import { Textarea } from "@/components/ui/textarea";

interface ArrayTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string[];
  onChange: (value: string[]) => void;
}

export function ArrayTextarea({ value, onChange, ...props }: ArrayTextareaProps) {
  const [text, setText] = useState(value.join("\n"));

  useEffect(() => {
    setText(value.join("\n"));
  }, [value]);

  const handleBlur = () => {
    const newArray = text.split("\n").map(s => s.trim()).filter(Boolean);
    onChange(newArray);
    setText(newArray.join("\n"));
  };

  return (
    <Textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={handleBlur}
      {...props}
    />
  );
}
