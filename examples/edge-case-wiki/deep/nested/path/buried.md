# Buried

Sits 3 folders deep (`deep/nested/path/`), the one departure from this fixture's otherwise-flat
layout — exercises the parser's recursive walk and confirms `type` still derives from the
**top-level** subfolder (`deep`) rather than the full path.

The same image, referenced via `../../../` to exercise relative-path collapsing:

![Same diagram, three levels up](../../../assets/diagram.svg)

Back to [[hello]].
