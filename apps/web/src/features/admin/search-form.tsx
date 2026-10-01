import { buttonClassName } from "@capital-q/ui/button";
import { fieldControlClassName } from "@capital-q/ui/input";

/** A plain GET search form: the query lives in the URL, so it can be shared. */
export function SearchForm({
  action,
  value,
  label,
  placeholder,
}: {
  readonly action: string;
  readonly value: string;
  readonly label: string;
  readonly placeholder: string;
}) {
  return (
    <form action={action} method="get" role="search" className="flex gap-2">
      <label htmlFor="admin-search" className="sr-only">
        {label}
      </label>
      <input
        id="admin-search"
        name="q"
        type="search"
        defaultValue={value}
        placeholder={placeholder}
        minLength={2}
        className={`${fieldControlClassName} h-11 cq-body lg:h-10`}
      />
      <button type="submit" className={buttonClassName("secondary")}>
        Search
      </button>
    </form>
  );
}
