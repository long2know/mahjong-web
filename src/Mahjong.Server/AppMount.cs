namespace Mahjong.Server;

internal static class AppMount
{
    private const string PrefixHeader = "X-Forwarded-Prefix";

    public static void Use(WebApplication app, ServerOptions options)
    {
        var prefix = options.PathBase;
        var forwardedPrefix = prefix.HasValue ? prefix : new PathString("/");
        app.Use(async (context, next) =>
        {
            context.Response.Headers.XContentTypeOptions = "nosniff";
            var request = context.Request;
            // Validate the single raw value before ForwardedHeaders can parse or consume it.
            if (request.PathBase.HasValue || (request.Headers.TryGetValue(PrefixHeader, out var supplied)
                && (supplied.Count != 1 || supplied[0] != forwardedPrefix.Value)))
            {
                await HttpApi.Error(400, "invalid_request").ExecuteAsync(context);
                return;
            }
            await next(context);
        });

        app.UseForwardedHeaders();

        app.Use(async (context, next) =>
        {
            var request = context.Request;
            // An unconsumed header wasn't accepted from a trusted peer.
            if (request.Headers.ContainsKey(PrefixHeader) || (request.PathBase.HasValue
                && !request.PathBase.Equals(forwardedPrefix, StringComparison.Ordinal)))
            {
                await HttpApi.Error(400, "invalid_request").ExecuteAsync(context);
                return;
            }
            if (prefix.HasValue && !request.PathBase.HasValue)
            {
                if (!request.Path.StartsWithSegments(prefix, StringComparison.Ordinal, out var remainder))
                {
                    context.Response.StatusCode = StatusCodes.Status404NotFound;
                    return;
                }
                if (!remainder.HasValue && (HttpMethods.IsGet(request.Method) || HttpMethods.IsHead(request.Method)))
                {
                    await Results.Redirect(options.BaseHref + request.QueryString.ToUriComponent(),
                        permanent: true, preserveMethod: true).ExecuteAsync(context);
                    return;
                }
                request.PathBase = prefix;
                request.Path = remainder;
            }
            else if (!prefix.HasValue)
            {
                request.PathBase = PathString.Empty;
            }
            await next(context);
        });
    }
}
