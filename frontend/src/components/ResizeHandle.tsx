import { Separator } from "react-resizable-panels";

function ResizeHandle(): React.ReactElement {
  return (
    <Separator className="group relative flex w-1 items-center justify-center bg-border-primary transition-colors hover:bg-accent-primary">
      <div className="absolute z-10 flex h-8 w-3 items-center justify-center rounded-full bg-border-primary opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100">
        <div className="flex flex-col gap-0.5">
          <span className="block h-0.5 w-0.5 rounded-full bg-text-tertiary" />
          <span className="block h-0.5 w-0.5 rounded-full bg-text-tertiary" />
          <span className="block h-0.5 w-0.5 rounded-full bg-text-tertiary" />
        </div>
      </div>
    </Separator>
  );
}

export default ResizeHandle;
