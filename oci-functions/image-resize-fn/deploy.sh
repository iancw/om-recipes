source .env.cli
# Resolve app ID/name from function ID
# export FN_APP_ID="$(oci fn function get --function-id "$FN_FUNCTION_ID" --query 'data."application-id"' --raw-output)"
# export FN_APP_NAME="$(oci fn application get --application-id "$FN_APP_ID" --query 'data."display-name"' --raw-output)"
# echo "$FN_APP_ID / $FN_APP_NAME"

# Deploy (build + push + update function)
fn deploy --app "$FN_APP_NAME" --verbose

# 2) Verify new version is live
# oci fn function get --function-id "$FN_FUNCTION_ID" \
  # --query 'data.{name:"display-name",image:image,timeUpdated:"time-updated"}'
