package co.laplayita.minimarket;

import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.CustomCredential;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PlayitaGoogle")
public class GoogleSignInPlugin extends Plugin {
    private CancellationSignal pending;
    @PluginMethod
    public void signIn(PluginCall call) {
        String clientId = call.getString("clientId");
        String nonce = call.getString("nonce");
        if (clientId == null || !clientId.endsWith(".apps.googleusercontent.com") || nonce == null || nonce.length() < 32) {
            call.reject("Google no configurado", "GOOGLE_NOT_CONFIGURED"); return;
        }
        getActivity().runOnUiThread(() -> {
            if (pending != null) { call.reject("Acceso en curso", "GOOGLE_BUSY"); return; }
            pending = new CancellationSignal();
            GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build();
            GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
            CredentialManager.create(getContext()).getCredentialAsync(getActivity(), request, pending,
                ContextCompat.getMainExecutor(getContext()), new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override public void onResult(GetCredentialResponse response) {
                        pending = null;
                        try {
                            Credential credential = response.getCredential();
                            if (!(credential instanceof CustomCredential) || !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                call.reject("Respuesta de Google no válida", "GOOGLE_SIGNIN_FAILED"); return;
                            }
                            GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                            JSObject result = new JSObject(); result.put("credential", google.getIdToken()); call.resolve(result);
                        } catch (Exception ignored) { call.reject("No fue posible verificar Google", "GOOGLE_SIGNIN_FAILED"); }
                    }
                    @Override public void onError(GetCredentialException error) {
                        pending = null;
                        call.reject("Acceso con Google cancelado o no disponible", "GOOGLE_SIGNIN_FAILED");
                    }
                });
        });
    }
    @Override protected void handleOnDestroy() { if (pending != null) pending.cancel(); pending = null; }
}
