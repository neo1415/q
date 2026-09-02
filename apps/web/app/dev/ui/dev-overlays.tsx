"use client";

import { Button } from "@capital-q/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTrigger,
} from "@capital-q/ui/dialog";
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "@capital-q/ui/menu";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@capital-q/ui/popover";
import { SheetContent, SheetRoot, SheetTrigger } from "@capital-q/ui/sheet";
import { Tooltip, TooltipProvider } from "@capital-q/ui/tooltip";

/** Interactive overlay demos for the development preview only. */
export function DevOverlays() {
  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-3">
        <Tooltip content="Tooltips add detail, never the name.">
          <Button variant="secondary">Hover or focus me</Button>
        </Tooltip>

        <MenuRoot>
          <MenuTrigger>
            <Button variant="secondary">Menu</Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem>Rename</MenuItem>
            <MenuItem>Duplicate</MenuItem>
            <MenuSeparator />
            <MenuItem tone="danger">Remove</MenuItem>
          </MenuContent>
        </MenuRoot>

        <PopoverRoot>
          <PopoverTrigger>
            <Button variant="secondary">Popover</Button>
          </PopoverTrigger>
          <PopoverContent title="Why this appears">
            Short contextual detail anchored to a control.
          </PopoverContent>
        </PopoverRoot>

        <SheetRoot>
          <SheetTrigger>
            <Button variant="secondary">Bottom sheet</Button>
          </SheetTrigger>
          <SheetContent
            title="Sheet"
            description='Bottom sheet on phones; the same component becomes a side panel on desktop when side="side".'
          >
            <p className="cq-body text-(--cq-text-primary)">Sheet content.</p>
          </SheetContent>
        </SheetRoot>

        <SheetRoot>
          <SheetTrigger>
            <Button variant="secondary">Side sheet</Button>
          </SheetTrigger>
          <SheetContent side="side" title="Side sheet">
            <p className="cq-body text-(--cq-text-primary)">
              Bottom on phones, right-hand panel on desktop.
            </p>
          </SheetContent>
        </SheetRoot>

        <DialogRoot>
          <DialogTrigger>
            <Button variant="primary">Dialog</Button>
          </DialogTrigger>
          <DialogContent
            title="Send the introduction?"
            description="Q prepared this introduction. It is sent only once you approve it."
            actions={
              <>
                <DialogClose>
                  <Button variant="quiet">Cancel</Button>
                </DialogClose>
                <DialogClose>
                  <Button variant="primary">Approve and send</Button>
                </DialogClose>
              </>
            }
          />
        </DialogRoot>
      </div>
    </TooltipProvider>
  );
}
