# @rophpad/dashu-next

Web `Request`/`Response` route handlers for integrating Dashu with Next.js App Router. Your application supplies authentication and authorization.

## Install

```bash
npm install @rophpad/dashu-core @rophpad/dashu-next
```

## Ask route

```ts
// app/api/dashu/ask/route.ts
import { dashuRoute } from "@rophpad/dashu-next";
import { dashu } from "@/lib/dashu";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs"; // required by the PostgreSQL adapter

export const POST = dashuRoute(dashu, {
  getActor: async () => {
    const user = await currentUser();
    if (!user?.isAdmin) return null;
    return { id: user.id, tenantId: user.tenantId, permissions: user.permissions };
  },
});
```

Actor, tenant, permissions, policy, semantic vocabulary, and source selection must come from trusted server state—not request JSON.

Also exported: `dashuRunRoute` for revalidating/replaying stored SQL and `dashuSchemaRoute` for returning the approved schema.

## Documentation

- [Complete Next.js quick start](https://github.com/rophpad/dashu/blob/main/docs/getting-started/nextjs-quickstart.md)
- [Routes and option reference](https://github.com/rophpad/dashu/blob/main/docs/guides/routes-and-frameworks.md)
- [Authorization and multi-tenancy](https://github.com/rophpad/dashu/blob/main/docs/guides/authorization-policy-multitenancy.md)

## License

Apache-2.0
