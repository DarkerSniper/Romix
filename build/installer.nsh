; Romix keeps everything it creates in a "data" folder next to Romix.exe
; (saved discs, shelf history, settings, the audio cache and its downloaded tools).
; electron-builder's default uninstaller deletes the whole install folder, which
; would wipe that data on every update. This replaces it:
;   - updating: remove the old app files, always keep data
;   - uninstalling: ask whether to delete the data too (default: keep it);
;     a silent uninstall always keeps it.

!macro customRemoveFiles
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      IfFileExists "$INSTDIR\data\*.*" 0 romixKeepData
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete Romix's data?$\r$\n$\r$\nThis removes your saved discs, shelf history, settings and the tools Romix downloaded.$\r$\nChoose No to keep them for a future install." IDNO romixKeepData
        RMDir /r "$INSTDIR"
        Goto romixDone
    ${endIf}
  ${endIf}

  romixKeepData:
  ; Remove everything Romix installed except the data folder.
  FindFirst $R0 $R1 "$INSTDIR\*.*"
  romixLoop:
    StrCmp $R1 "" romixLoopEnd
    StrCmp $R1 "." romixNext
    StrCmp $R1 ".." romixNext
    StrCmp $R1 "data" romixNext
    IfFileExists "$INSTDIR\$R1\*.*" 0 romixFile
      RMDir /r "$INSTDIR\$R1"
      Goto romixNext
    romixFile:
      Delete "$INSTDIR\$R1"
  romixNext:
    FindNext $R0 $R1
    Goto romixLoop
  romixLoopEnd:
  FindClose $R0
  ; Only removes the folder if nothing (i.e. no data) is left.
  RMDir "$INSTDIR"

  romixDone:
!macroend
