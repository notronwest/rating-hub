import { useParams } from "react-router-dom";
import { ImportPbVisionJson } from "../admin/ImportPbVisionJson";

export default function ImportPage() {
  const { orgId } = useParams();
  return <ImportPbVisionJson orgId={orgId ?? "wmpc"} />;
}
