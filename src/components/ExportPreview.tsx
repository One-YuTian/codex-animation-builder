import { useEffect, useState } from "react";
import { readImageFile } from "../files";
export function ExportPreview({file, mimeType}: {file: string; mimeType: string}) {
  const [url,setUrl] = useState(""); const [error,setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(); let objectUrl: string | undefined;
    setUrl(""); setError("");
    void readImageFile(file,controller.signal).then(blob => {
      if(controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(new Blob([blob],{type:mimeType}));setUrl(objectUrl);
    }).catch(e => {if(!controller.signal.aborted)setError(String(e));});
    return () => {controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[file,mimeType]);
  return <section className="export-preview" aria-label="导出预览"><strong>导出预览</strong>{error ? <p role="alert">{error}</p> : !url ? <p>正在加载成品…</p> : mimeType.startsWith("video/") ? <video src={url} autoPlay loop muted playsInline controls onError={() => setError("视频播放失败，当前客户端可能不支持此编码")} /> : <img src={url} alt="导出成品预览" onError={() => setError("图片预览失败")} />}</section>;
}
