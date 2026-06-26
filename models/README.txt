Place model weight files here.

Local models reference a .gguf file by name in their config JSON, e.g.:
{
  "type": "local",
  "api": "none",
  "model": "my-model.gguf"
}

The .gguf file must live in THIS folder alongside its JSON config.
